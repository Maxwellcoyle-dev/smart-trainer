/**
 * Stage — Dynamic adaptation classifier (design §5).
 *
 * Pure module: NO LLM, NO DB. Given an event (a logged session, a check-in that
 * raised a flag, a missed session, a week/phase rollover) plus the current
 * plan-week context, it decides:
 *
 *   • whether anything should change at all,
 *   • whether the change is MINOR (safe to auto-apply: logged, notified, one-tap
 *     undo) or MAJOR (must go to the approval queue), and
 *   • the exact `AdaptationDiff` array that expresses the MINOR change.
 *
 * The minor/major boundary is the heart of the auto-apply decision (design §5.2).
 * MINOR changes are tightly bounded — they touch ≤ MINOR_MAX_SESSIONS sessions,
 * stay inside the current week, never cross a phase boundary, never exceed an
 * engine volume cap, and never touch goals or phase structure. Anything outside
 * that envelope is MAJOR and is only ever *proposed*.
 *
 * This is the highest-leverage test surface in G4: the classifier is pure, so
 * the minor/major boundary is asserted directly in unit tests.
 */

import type {
  AdaptationDiff,
  InjuryFlag,
  PrescribedSession,
  SportType,
} from "../types.js";
import { LOWER_LIMB_PARTS } from "./periodization.js";

// ─── Tunable constants (the adaptation guardrails) ────────────────────────────

/** A logged session at/below this RPE "felt easy" → nudge the next one up. */
export const EASY_RPE = 3;

/** A logged session at/above this RPE "felt hard" → ease the next one down. */
export const HARD_RPE = 8;

/** Minor volume/intensity scale step (design §5.2: within ±15%). */
export const SCALE_PCT = 0.15;

/** A minor change may touch at most this many sessions (design §5.2 guardrail). */
export const MINOR_MAX_SESSIONS = 2;

/**
 * G5 (design §6.3): when a phase ends with the base gate still closed and the
 * next phase needs a distance build, the dated event *slides* by this many
 * weeks rather than forcing volume onto an unready body.
 */
export const SLIP_WEEKS = 4;

/** Phase types whose weekly targets assume an open distance-build gate. */
export const DISTANCE_BUILD_PHASES = new Set(["build", "peak"]);

// ─── Event + context types ────────────────────────────────────────────────────

export type AdaptationTier = "minor" | "major" | "none";

/** Minimal summary of what was just logged against a prescription. */
export interface LoggedSummary {
  sport: SportType;
  session_rpe: number | null;
}

export type AdaptationEvent =
  | {
      type: "session.logged";
      /** The prescription this log fulfilled, if any (excluded from "upcoming"). */
      prescribed_session_id: string | null;
      logged: LoggedSummary;
    }
  | {
      type: "checkin.submitted";
      /** Flags newly raised or escalated by this check-in (see writes.logCheckIn). */
      raised_flags: InjuryFlag[];
    }
  | { type: "session.missed"; prescribed_session_id: string }
  | { type: "week.completed"; week_index: number; week_id?: string }
  | { type: "phase.ending"; phase_index: number; phase_id?: string };

/** The current plan week — only its id, index, start and targets are needed. */
export interface AdaptationWeek {
  id: string;
  week_index: number;
  start_date: string | null;
  targets: Record<string, unknown>;
}

export interface AdaptationContext {
  today: string; // ISO date (YYYY-MM-DD)
  week: AdaptationWeek;
  /** All prescribed sessions in the current week (the only scope minor may touch). */
  weekSessions: PrescribedSession[];
  /** Open injury flags (status != resolved). */
  activeFlags: InjuryFlag[];
  /**
   * True when run volume is capped (base gate closed or a lower-limb flag is
   * active). While capped, an "easy" run is NOT scaled up — keeping the engine
   * cap literally inviolable even under auto-adaptation.
   */
  runCapped: boolean;
  /**
   * G5: phase context for `phase.ending` decisions. `nextType` is the type of
   * the phase after the one ending (null when the plan is finishing).
   */
  phase?: { index: number; type: string | null; nextType: string | null };
  /** G5: the primary dated goal the plan builds toward, if any. */
  primaryGoal?: { id: string; title: string; target_date: string | null };
}

export interface AdaptationDecision {
  tier: AdaptationTier;
  action_type: string;
  diffs: AdaptationDiff[];
  rationale: string;
  /** Human-facing notification for an auto-applied minor change. */
  notify?: string;
}

// ─── Date helpers (pure, UTC) ─────────────────────────────────────────────────

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Session selection helpers ────────────────────────────────────────────────

/** Planned sessions scheduled today or later, earliest first. */
function upcoming(ctx: AdaptationContext): PrescribedSession[] {
  return ctx.weekSessions
    .filter(
      (s) =>
        s.status === "planned" &&
        s.scheduled_date != null &&
        s.scheduled_date >= ctx.today
    )
    .sort(
      (a, b) =>
        (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "") ||
        a.day_of_week - b.day_of_week ||
        a.order_in_day - b.order_in_day
    );
}

function weekIsDeload(ctx: AdaptationContext): boolean {
  return ctx.week.targets?.deload === true;
}

/** Days (0=Mon … 6=Sun) strictly after today that still fall in this week. */
function remainingDays(ctx: AdaptationContext): number[] {
  const start = ctx.week.start_date;
  if (!start) return [];
  const out: number[] = [];
  for (let d = 0; d <= 6; d++) {
    if (addDays(start, d) > ctx.today) out.push(d);
  }
  return out;
}

// ─── Pure diff builders (prescribed_sessions only) ────────────────────────────

/**
 * Scale one upcoming session's intensity/volume by `factor` (e.g. 1.15 / 0.85).
 * Carries the whole `prescription` object in before/after so the generic apply
 * engine's update-inverse restores it exactly on undo.
 */
export function scaleSessionDiff(
  s: PrescribedSession,
  factor: number,
  note: string
): AdaptationDiff {
  const presc = (s.prescription ?? {}) as Record<string, unknown>;
  const prevScale = typeof presc.scale === "number" ? presc.scale : 1;
  const newScale = round2(prevScale * factor);
  return {
    entity_type: "prescribed_sessions",
    entity_id: s.id,
    op: "update",
    before: { prescription: presc },
    after: { prescription: { ...presc, scale: newScale, adjust_note: note } },
    fields: ["prescription"],
  };
}

/** Move a (still-planned, missed) session to a new open day inside the week. */
export function rescheduleSessionDiff(
  s: PrescribedSession,
  newDayOfWeek: number,
  newScheduledDate: string
): AdaptationDiff {
  return {
    entity_type: "prescribed_sessions",
    entity_id: s.id,
    op: "update",
    before: { day_of_week: s.day_of_week, scheduled_date: s.scheduled_date },
    after: { day_of_week: newDayOfWeek, scheduled_date: newScheduledDate },
    fields: ["day_of_week", "scheduled_date"],
  };
}

/** Swap a run for low-impact cross-training (lower-limb flag active). */
export function swapModalityDiff(s: PrescribedSession, note: string): AdaptationDiff {
  const presc = (s.prescription ?? {}) as Record<string, unknown>;
  return {
    entity_type: "prescribed_sessions",
    entity_id: s.id,
    op: "update",
    before: { sport: s.sport, prescription: presc },
    after: {
      sport: "cross_train",
      prescription: { ...presc, kind: "cross_train", adjust_note: note },
    },
    fields: ["sport", "prescription"],
  };
}

/** Insert a prehab strength slot tied to an active flag. */
export function insertPrehabDiff(
  planWeekId: string,
  dayOfWeek: number,
  scheduledDate: string,
  orderInDay: number,
  flag: InjuryFlag
): AdaptationDiff {
  return {
    entity_type: "prescribed_sessions",
    entity_id: null,
    op: "create",
    before: null,
    after: {
      plan_week_id: planWeekId,
      day_of_week: dayOfWeek,
      scheduled_date: scheduledDate,
      sport: "strength",
      order_in_day: orderInDay,
      prescription: {
        kind: "strength",
        hint: `Prehab for ${flag.body_part} flag`,
        adjust_note: "Auto-inserted prehab — injury flag active",
      },
      status: "planned",
      injury_flag_id: flag.id,
    },
    fields: ["plan_week_id", "day_of_week", "scheduled_date", "sport", "prescription", "injury_flag_id"],
  };
}

// ─── Minor-guardrail validator (design §5.2) ──────────────────────────────────

export interface GuardrailResult {
  ok: boolean;
  reason?: string;
}

/**
 * Re-assert the minor envelope on a candidate diff set: at least one and at most
 * MINOR_MAX_SESSIONS sessions, every diff on prescribed_sessions inside the
 * current week, no deletes (minor never destroys), no goal/phase-structure
 * touch. A classified-minor decision that fails this is downgraded to major.
 */
export function withinMinorGuardrails(
  diffs: AdaptationDiff[],
  ctx: AdaptationContext
): GuardrailResult {
  if (diffs.length === 0) return { ok: false, reason: "no diffs" };
  if (diffs.length > MINOR_MAX_SESSIONS) {
    return { ok: false, reason: `touches ${diffs.length} sessions (max ${MINOR_MAX_SESSIONS})` };
  }
  const weekIds = new Set(ctx.weekSessions.map((s) => s.id));
  for (const d of diffs) {
    if (d.entity_type !== "prescribed_sessions") {
      return { ok: false, reason: `minor may not touch "${d.entity_type}"` };
    }
    if (d.op === "delete") return { ok: false, reason: "minor never deletes a session" };
    if (d.op === "update" && d.entity_id && !weekIds.has(d.entity_id)) {
      return { ok: false, reason: "update targets a session outside the current week" };
    }
    if (d.op === "create") {
      const wk = (d.after as Record<string, unknown> | null)?.plan_week_id;
      if (wk !== ctx.week.id) return { ok: false, reason: "create lands outside the current week" };
    }
  }
  return { ok: true };
}

// ─── Decision constructors ────────────────────────────────────────────────────

function none(rationale: string): AdaptationDecision {
  return { tier: "none", action_type: "noop", diffs: [], rationale };
}

function minor(
  action_type: string,
  diffs: AdaptationDiff[],
  rationale: string,
  notify: string
): AdaptationDecision {
  return { tier: "minor", action_type, diffs, rationale, notify };
}

function major(action_type: string, diffs: AdaptationDiff[], rationale: string): AdaptationDecision {
  return { tier: "major", action_type, diffs, rationale };
}

// ─── Event classifiers ────────────────────────────────────────────────────────

function classifyLogged(
  event: Extract<AdaptationEvent, { type: "session.logged" }>,
  ctx: AdaptationContext
): AdaptationDecision {
  const rpe = event.logged.session_rpe;
  if (rpe == null) return none("No RPE on the logged session — nothing to adapt.");

  const sport = event.logged.sport;
  const next = upcoming(ctx).find(
    (s) => s.sport === sport && s.id !== event.prescribed_session_id
  );
  if (!next) return none(`No upcoming ${sport} session this week to scale.`);

  const pct = Math.round(SCALE_PCT * 100);

  if (rpe <= EASY_RPE) {
    if (weekIsDeload(ctx)) {
      return none("Deload week — holding planned volume despite an easy session.");
    }
    if (sport === "run" && ctx.runCapped) {
      return none("Run volume is capped (injury/base gate) — not increasing despite the easy effort.");
    }
    const note = `Felt easy (RPE ${rpe}) — nudged +${pct}% within the ramp cap.`;
    return minor(
      "scale_session",
      [scaleSessionDiff(next, 1 + SCALE_PCT, note)],
      `Logged ${sport} at RPE ${rpe} (≤${EASY_RPE}); scaling the next ${sport} up ${pct}%.`,
      `Coach nudged your next ${sport} up ${pct}% — last one felt easy. Undo?`
    );
  }

  if (rpe >= HARD_RPE) {
    const note = `Felt hard (RPE ${rpe}) — eased -${pct}%.`;
    return minor(
      "scale_session",
      [scaleSessionDiff(next, 1 - SCALE_PCT, note)],
      `Logged ${sport} at RPE ${rpe} (≥${HARD_RPE}); easing the next ${sport} by ${pct}%.`,
      `Coach eased your next ${sport} ${pct}% — last one felt hard. Undo?`
    );
  }

  return none(`RPE ${rpe} is within the normal band (${EASY_RPE}–${HARD_RPE}) — no change.`);
}

function classifyCheckin(
  event: Extract<AdaptationEvent, { type: "checkin.submitted" }>,
  ctx: AdaptationContext
): AdaptationDecision {
  const raised = (event.raised_flags ?? []).filter((f) => f.status !== "resolved");
  if (raised.length === 0) return none("Check-in raised no flags — no plan change.");

  const lowerLimb = raised.filter((f) => LOWER_LIMB_PARTS.includes(f.body_part));
  const hasPlannedPrehab = ctx.weekSessions.some(
    (s) => s.sport === "strength" && s.status === "planned"
  );

  if (lowerLimb.length > 0) {
    const flag = lowerLimb[0];
    const upcomingRuns = upcoming(ctx).filter((s) => s.sport === "run");

    // Escalation that would cap MORE than one run this week is structural → MAJOR.
    if (upcomingRuns.length > 1) {
      const parts = [...new Set(lowerLimb.map((f) => f.body_part))].join(", ");
      return major(
        "insert_deload",
        [],
        `${parts} flagged with ${upcomingRuns.length} runs still scheduled this week — capping running across the block is structural; proposing a modality/deload adjustment for approval.`
      );
    }

    const diffs: AdaptationDiff[] = [];
    const notes: string[] = [];

    if (upcomingRuns.length === 1) {
      diffs.push(
        swapModalityDiff(upcomingRuns[0], `${flag.body_part} flagged — swapped run for low-impact cardio.`)
      );
      notes.push("swapped your next run for low-impact cardio");
    }

    if (!hasPlannedPrehab && diffs.length < MINOR_MAX_SESSIONS) {
      const day = remainingDays(ctx)[0] ?? 3;
      const date = ctx.week.start_date ? addDays(ctx.week.start_date, day) : ctx.today;
      const order = ctx.weekSessions.filter((s) => s.day_of_week === day).length;
      diffs.push(insertPrehabDiff(ctx.week.id, day, date, order, flag));
      notes.push(`added a ${flag.body_part} prehab set`);
    }

    if (diffs.length === 0) {
      return none(`${flag.body_part} flagged, but no upcoming run to swap and prehab already scheduled.`);
    }

    const action_type = diffs.some((d) => d.op === "update") ? "swap_modality" : "insert_prehab";
    return minor(
      action_type,
      diffs,
      `${flag.body_part} flag raised — ${notes.join(" and ")} (auto-applied, reversible).`,
      `Coach ${notes.join(" and ")} — ${flag.body_part} was flagged. Undo?`
    );
  }

  // Non-lower-limb flag (e.g. shoulder/finger) → reinforce prehab only.
  if (hasPlannedPrehab) {
    return none("Flag raised, but a prehab/strength session is already scheduled this week.");
  }
  const flag = raised[0];
  const day = remainingDays(ctx)[0] ?? 3;
  const date = ctx.week.start_date ? addDays(ctx.week.start_date, day) : ctx.today;
  const order = ctx.weekSessions.filter((s) => s.day_of_week === day).length;
  return minor(
    "insert_prehab",
    [insertPrehabDiff(ctx.week.id, day, date, order, flag)],
    `${flag.body_part} flag raised — inserted a prehab set (auto-applied, reversible).`,
    `Coach added a ${flag.body_part} prehab set — it was flagged. Undo?`
  );
}

function classifyMissed(
  event: Extract<AdaptationEvent, { type: "session.missed" }>,
  ctx: AdaptationContext
): AdaptationDecision {
  const missed = ctx.weekSessions.find((s) => s.id === event.prescribed_session_id);
  if (!missed) return none("Missed session is not in the current-week context.");
  if (missed.status === "completed") return none("Session was completed — nothing to reschedule.");

  // An open day = a remaining day this week with no other (non-skipped) session.
  const usedDays = new Set(
    ctx.weekSessions
      .filter((s) => s.id !== missed.id && s.status !== "skipped")
      .map((s) => s.day_of_week)
  );
  const open = remainingDays(ctx).find((d) => !usedDays.has(d));
  if (open == null) {
    return none("No open day left this week — leaving the missed session to stand as skipped.");
  }

  const date = addDays(ctx.week.start_date ?? ctx.today, open);
  return minor(
    "reschedule_session",
    [rescheduleSessionDiff(missed, open, date)],
    `Missed ${missed.sport} rescheduled into an open day later this week.`,
    `Coach moved your missed ${missed.sport} to ${date}. Undo?`
  );
}

// ─── phase.ending (G5, design §6.3) ───────────────────────────────────────────

/**
 * A phase is rolling over. Two outcomes, both MAJOR (phase structure is never
 * auto-applied):
 *
 *   • Gate still closed + the next phase assumes a distance build → the plan's
 *     stated assumption fires: propose sliding the primary dated goal by
 *     SLIP_WEEKS ("the event slides rather than forcing volume"). The diff is a
 *     single goals update — applyable, and one undo restores the original date.
 *     Approving the slip is the athlete's cue to regenerate the plan around the
 *     new date.
 *   • Otherwise → propose generating the next phase block (existing behaviour).
 */
export function classifyPhaseEnding(
  event: Extract<AdaptationEvent, { type: "phase.ending" }>,
  ctx: AdaptationContext
): AdaptationDecision {
  const goal = ctx.primaryGoal;
  const nextNeedsDistance =
    ctx.phase?.nextType != null && DISTANCE_BUILD_PHASES.has(ctx.phase.nextType);

  if (ctx.runCapped && nextNeedsDistance && goal?.target_date) {
    const slipped = addDays(goal.target_date, SLIP_WEEKS * 7);
    return major(
      "slip_event",
      [
        {
          entity_type: "goals",
          entity_id: goal.id,
          op: "update",
          before: { target_date: goal.target_date },
          after: { target_date: slipped },
          fields: ["target_date"],
        },
      ],
      `Phase ${event.phase_index} is ending but the base gate is still closed ` +
        `(lower-limb flag active), and the next phase assumes a distance build. ` +
        `Rather than forcing volume, this proposes sliding "${goal.title}" from ` +
        `${goal.target_date} to ${slipped} (+${SLIP_WEEKS} weeks). If you approve, ` +
        `regenerate the plan to rebuild the phases around the new date.`
    );
  }

  return major(
    "generate_phase",
    [],
    `Phase ${event.phase_index} ending — proposing the next phase block for approval.`
  );
}

// ─── Top-level classifier ─────────────────────────────────────────────────────

/**
 * Classify an adaptation event into none / minor / major (design §5.2). MINOR
 * decisions are re-checked against the guardrail validator and downgraded to
 * MAJOR if they somehow exceed the envelope — so the auto-apply path is provably
 * bounded no matter how the per-event logic evolves.
 */
export function classifyAdaptation(
  event: AdaptationEvent,
  ctx: AdaptationContext
): AdaptationDecision {
  let decision: AdaptationDecision;
  switch (event.type) {
    case "session.logged":
      decision = classifyLogged(event, ctx);
      break;
    case "checkin.submitted":
      decision = classifyCheckin(event, ctx);
      break;
    case "session.missed":
      decision = classifyMissed(event, ctx);
      break;
    case "week.completed":
      decision = major(
        "generate_week",
        [],
        `Week ${event.week_index} complete — reviewing adherence and ramp to shape the next week (proposed for approval).`
      );
      break;
    case "phase.ending":
      decision = classifyPhaseEnding(event, ctx);
      break;
    default:
      decision = none("Unrecognized event.");
  }

  // Defence in depth: a minor that breaches the envelope becomes a proposal.
  if (decision.tier === "minor") {
    const guard = withinMinorGuardrails(decision.diffs, ctx);
    if (!guard.ok) {
      return {
        tier: "major",
        action_type: decision.action_type,
        diffs: decision.diffs,
        rationale: `${decision.rationale} (escalated to a proposal: ${guard.reason}.)`,
      };
    }
  }

  return decision;
}
