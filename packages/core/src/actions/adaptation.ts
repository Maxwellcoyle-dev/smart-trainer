/**
 * Adaptation orchestration (design §5.2–§5.3).
 *
 * The DB-touching counterpart to the pure `classifyAdaptation` engine. It:
 *   1. records an `ai_job_runs` row (the hook seam — every run is audited),
 *   2. builds the current-week context from the active plan + injury flags,
 *   3. classifies the event,
 *   4. applies the per-user **autonomy** setting (design §5.3):
 *        • "conservative" → propose everything (the original §9 behaviour),
 *        • "balanced"     → auto-apply MINOR, propose MAJOR  (default),
 *   5. for an auto-applied minor: writes through the SAME audited apply engine,
 *      appends an `adaptation_logs` row (source "hook"), and returns the
 *      one-tap-undo log id + a notification string,
 *   6. for a major (or any change under "conservative"): creates a proposal.
 *
 * Hooks run after the originating write and are error-isolated by the caller, so
 * a hook failure never fails a log.
 */

import { SupabaseClient } from "../db.js";
import { applyDiff } from "./apply.js";
import { createProposal } from "./writes.js";
import { getCurrentPlan, getGoals, getInjuryFlags, getProfile } from "./reads.js";
import { LOWER_LIMB_PARTS } from "../engine/periodization.js";
import {
  classifyAdaptation,
  type AdaptationContext,
  type AdaptationDecision,
  type AdaptationEvent,
} from "../engine/adaptation.js";
import type {
  AdaptationDiff,
  Goal,
  InjuryFlag,
  Phase,
  Plan,
  PlanWeek,
  PrescribedSession,
  Proposal,
} from "../types.js";

// ─── Autonomy (design §5.3) ───────────────────────────────────────────────────

export type Autonomy = "conservative" | "balanced";

export const DEFAULT_AUTONOMY: Autonomy = "balanced";

/** Read the autonomy level from profiles.preferences; default "balanced". */
export function resolveAutonomy(
  preferences: Record<string, unknown> | null | undefined
): Autonomy {
  return (preferences?.autonomy as Autonomy) === "conservative"
    ? "conservative"
    : "balanced";
}

// ─── Current-week context selection (pure) ────────────────────────────────────

export type LoadedPlan = Plan & {
  phases: (Phase & {
    plan_weeks: (PlanWeek & { prescribed_sessions: PrescribedSession[] })[];
  })[];
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function flattenWeeks(
  plan: LoadedPlan
): (PlanWeek & { prescribed_sessions: PrescribedSession[] })[] {
  return (plan.phases ?? []).flatMap((p) => p.plan_weeks ?? []);
}

function weekContains(week: PlanWeek, dateISO: string): boolean {
  if (!week.start_date) return false;
  return week.start_date <= dateISO && dateISO <= addDays(week.start_date, 6);
}

/**
 * Choose which plan week the event applies to and assemble the classifier's
 * context. For events that name a prescribed session, the owning week is used;
 * otherwise the week containing `today`. Pure — easy to unit-test.
 */
export function selectWeekContext(
  plan: LoadedPlan,
  flags: InjuryFlag[],
  event: AdaptationEvent,
  today: string,
  goals: Goal[] = []
): AdaptationContext | null {
  const weeks = flattenWeeks(plan);
  if (weeks.length === 0) return null;

  const namedId =
    event.type === "session.missed"
      ? event.prescribed_session_id
      : event.type === "session.logged"
        ? event.prescribed_session_id
        : null;

  let week: (PlanWeek & { prescribed_sessions: PrescribedSession[] }) | undefined;
  if (namedId) {
    week = weeks.find((w) =>
      (w.prescribed_sessions ?? []).some((s) => s.id === namedId)
    );
  }
  if (!week && event.type === "week.completed") {
    week = weeks.find((w) => w.week_index === event.week_index);
  }
  week = week ?? weeks.find((w) => weekContains(w, today));
  if (!week) return null;

  const runCapped = flags.some(
    (f) => f.status !== "resolved" && LOWER_LIMB_PARTS.includes(f.body_part)
  );

  // G5: phase + primary-dated-goal context for phase.ending decisions.
  let phaseCtx: AdaptationContext["phase"];
  let primaryGoal: AdaptationContext["primaryGoal"];
  if (event.type === "phase.ending") {
    const phases = [...(plan.phases ?? [])].sort((a, b) => a.phase_index - b.phase_index);
    const ending = phases.find((p) => p.phase_index === event.phase_index);
    const next = phases.find((p) => p.phase_index === event.phase_index + 1);
    phaseCtx = {
      index: event.phase_index,
      type: ending?.type ?? null,
      nextType: next?.type ?? null,
    };
    const dated = goals
      .filter((g) => g.status === "active" && g.target_date != null)
      .sort(
        (a, b) =>
          a.target_date!.localeCompare(b.target_date!) || a.priority - b.priority
      )[0];
    if (dated) {
      primaryGoal = { id: dated.id, title: dated.title, target_date: dated.target_date };
    }
  }

  return {
    today,
    week: {
      id: week.id,
      week_index: week.week_index,
      start_date: week.start_date,
      targets: (week.targets ?? {}) as Record<string, unknown>,
    },
    weekSessions: (week.prescribed_sessions ?? []).filter((s) => s.deleted_at == null),
    activeFlags: flags,
    runCapped,
    phase: phaseCtx,
    primaryGoal,
  };
}

// ─── ai_job_runs helpers ──────────────────────────────────────────────────────

async function startJob(
  db: SupabaseClient,
  userId: string,
  hook: string,
  triggerEvent: string
): Promise<string | null> {
  const { data, error } = await db
    .from("ai_job_runs")
    .insert({
      user_id: userId,
      hook,
      trigger_event: triggerEvent,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return null; // never let auditing failure break the hook
  return (data as { id: string }).id;
}

async function finishJob(
  db: SupabaseClient,
  jobId: string | null,
  status: "succeeded" | "failed" | "skipped",
  summary: string
): Promise<void> {
  if (!jobId) return;
  await db
    .from("ai_job_runs")
    .update({ status, output_summary: summary, finished_at: new Date().toISOString() })
    .eq("id", jobId);
}

/** Append one entry to the immutable adaptation ledger. Returns the log id. */
async function appendLog(
  db: SupabaseClient,
  userId: string,
  action_type: string,
  diff: AdaptationDiff | AdaptationDiff[],
  rationale: string | null,
  jobRunId: string | null
): Promise<string> {
  const { data, error } = await db
    .from("adaptation_logs")
    .insert({
      user_id: userId,
      source: "hook",
      action_type,
      diff,
      rationale,
      job_run_id: jobRunId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// ─── runAdaptation ────────────────────────────────────────────────────────────

export interface RunAdaptationResult {
  decision: AdaptationDecision;
  /** What actually happened given the autonomy setting. */
  outcome: "applied" | "proposed" | "skipped";
  autonomy: Autonomy;
  job_run_id?: string | null;
  /** adaptation_logs id when a minor was auto-applied (drives one-tap undo). */
  log_id?: string;
  /** the queued proposal when a major (or conservative) change was raised. */
  proposal?: Proposal;
  /** user-facing notification for an auto-applied minor. */
  notify?: string;
}

/**
 * Run the adaptation hook for one event. Loads context, classifies, and lands
 * the result per the user's autonomy setting. Always records an ai_job_runs row.
 * Callers fire this after the originating write (error-isolated).
 */
export async function runAdaptation(
  db: SupabaseClient,
  userId: string,
  event: AdaptationEvent,
  opts: { context?: AdaptationContext; autonomy?: Autonomy } = {}
): Promise<RunAdaptationResult> {
  const today = new Date().toISOString().slice(0, 10);
  // Rollover events are one-shot per entity — key the audit row so the
  // check* detectors can dedupe against it (P29/G5 heartbeat pattern).
  const trigger =
    event.type === "phase.ending"
      ? `phase.ending:${event.phase_id ?? event.phase_index}`
      : event.type === "week.completed"
        ? `week.completed:${event.week_id ?? event.week_index}`
        : event.type === "session.missed"
          ? `session.missed:${event.prescribed_session_id}`
          : event.type;
  const jobId = await startJob(db, userId, "adaptation", trigger);

  try {
    // Build context (unless the caller supplied one, e.g. tests).
    let ctx = opts.context ?? null;
    let autonomy = opts.autonomy;

    if (!ctx || autonomy == null) {
      const [plan, flags, profile, goals] = await Promise.all([
        getCurrentPlan(db, userId) as Promise<LoadedPlan | null>,
        getInjuryFlags(db, userId),
        getProfile(db, userId),
        event.type === "phase.ending" ? getGoals(db, userId) : Promise.resolve([] as Goal[]),
      ]);
      autonomy = autonomy ?? resolveAutonomy(profile?.preferences);
      if (!ctx) {
        if (!plan) {
          await finishJob(db, jobId, "skipped", "No active plan — nothing to adapt.");
          return {
            decision: { tier: "none", action_type: "noop", diffs: [], rationale: "No active plan." },
            outcome: "skipped",
            autonomy,
            job_run_id: jobId,
          };
        }
        ctx = selectWeekContext(plan, flags, event, today, goals);
        if (!ctx) {
          await finishJob(db, jobId, "skipped", "No current plan week for this event.");
          return {
            decision: { tier: "none", action_type: "noop", diffs: [], rationale: "No current plan week." },
            outcome: "skipped",
            autonomy,
            job_run_id: jobId,
          };
        }
      }
    }

    const resolvedAutonomy: Autonomy = autonomy ?? DEFAULT_AUTONOMY;
    const decision = classifyAdaptation(event, ctx);

    if (decision.tier === "none") {
      await finishJob(db, jobId, "succeeded", `none: ${decision.rationale}`);
      return { decision, outcome: "skipped", autonomy: resolvedAutonomy, job_run_id: jobId };
    }

    // Auto-apply only a MINOR under "balanced". Everything else is proposed.
    const autoApply = resolvedAutonomy === "balanced" && decision.tier === "minor";

    if (autoApply) {
      const { diffs } = await applyDiff(db, userId, decision.diffs);
      const logId = await appendLog(
        db,
        userId,
        decision.action_type,
        diffs,
        decision.rationale,
        jobId
      );
      await finishJob(db, jobId, "succeeded", `applied (minor): ${decision.action_type}`);
      return {
        decision,
        outcome: "applied",
        autonomy: resolvedAutonomy,
        job_run_id: jobId,
        log_id: logId,
        notify: decision.notify,
      };
    }

    // A major with no concrete diffs (e.g. week.completed → generate_week) has
    // nothing to apply yet — the scoped re-generation pipeline isn't built.
    // Surface it as a notification rather than queuing a dead, un-actionable
    // proposal. (P29 emits these from the daily heartbeat.)
    if (decision.diffs.length === 0) {
      await finishJob(db, jobId, "succeeded", `notify (no diff): ${decision.action_type}`);
      return {
        decision,
        outcome: "skipped",
        autonomy: resolvedAutonomy,
        job_run_id: jobId,
        notify: decision.rationale,
      };
    }

    // Proposed path.
    const proposal = await createProposal(
      db,
      userId,
      "hook",
      decision.action_type,
      decision.diffs,
      decision.rationale
    );
    const why =
      resolvedAutonomy === "conservative" && decision.tier === "minor"
        ? "proposed (conservative autonomy)"
        : `proposed (${decision.tier})`;
    await finishJob(db, jobId, "succeeded", `${why}: ${decision.action_type}`);
    return {
      decision,
      outcome: "proposed",
      autonomy: resolvedAutonomy,
      job_run_id: jobId,
      proposal,
    };
  } catch (err) {
    await finishJob(db, jobId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ─── checkPhaseEnding (G5) ────────────────────────────────────────────────────

/**
 * Detect a phase rollover and fire the `phase.ending` event exactly once per
 * phase. There is no scheduler in v1, so this piggybacks on the daily hooks
 * (call it after a check-in lands): if today falls inside the FINAL week of a
 * phase and no phase.ending job has run for that phase yet, run the adaptation.
 *
 * Dedupe rides the existing audit trail: runAdaptation records ai_job_runs with
 * trigger_event `phase.ending:<phase_id>`, so a prior row (any status) means
 * this phase was already handled. Error-isolated by callers like other hooks.
 */
export async function checkPhaseEnding(
  db: SupabaseClient,
  userId: string,
  preloaded?: LoadedPlan | null
): Promise<RunAdaptationResult | null> {
  const today = new Date().toISOString().slice(0, 10);
  const plan =
    preloaded !== undefined ? preloaded : ((await getCurrentPlan(db, userId)) as LoadedPlan | null);
  if (!plan) return null;

  for (const phase of plan.phases ?? []) {
    const weeks = [...(phase.plan_weeks ?? [])].sort((a, b) => a.week_index - b.week_index);
    const last = weeks[weeks.length - 1];
    if (!last || !weekContains(last, today)) continue;

    if (await hasJobRun(db, userId, `phase.ending:${phase.id}`)) return null;

    return runAdaptation(db, userId, {
      type: "phase.ending",
      phase_index: phase.phase_index,
      phase_id: phase.id,
    });
  }
  return null;
}

// ─── P29: missed-session + week-completed detection (the daily heartbeat) ────

/** Has an adaptation job already run for this dedupe key? */
async function hasJobRun(db: SupabaseClient, userId: string, trigger: string): Promise<boolean> {
  const { data } = await db
    .from("ai_job_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("trigger_event", trigger)
    .limit(1);
  return !!data && data.length > 0;
}

/**
 * Pure: prescribed sessions that are past-dated, still `planned`, and have no
 * log against them — i.e. silently skipped. Oldest first.
 */
export function findMissedSessions(plan: LoadedPlan, today: string): PrescribedSession[] {
  return flattenWeeks(plan)
    .flatMap((w) => w.prescribed_sessions ?? [])
    .filter(
      (s) =>
        s.deleted_at == null &&
        s.status === "planned" &&
        s.logged_session_id == null &&
        s.scheduled_date != null &&
        s.scheduled_date < today
    )
    .sort((a, b) => a.scheduled_date!.localeCompare(b.scheduled_date!));
}

/** Pure: the most recent plan week whose 7 days are fully in the past. */
export function latestCompletedWeek(plan: LoadedPlan, today: string): PlanWeek | null {
  const done = flattenWeeks(plan).filter(
    (w) => w.start_date != null && addDays(w.start_date, 6) < today
  );
  if (done.length === 0) return null;
  return done.sort((a, b) => b.week_index - a.week_index)[0];
}

/** Newest-first cap so a long gap can't flood the queue in one check-in. */
export const MISSED_SESSIONS_PER_CHECK = 3;

/**
 * Fire `session.missed` for silently skipped sessions — at most
 * MISSED_SESSIONS_PER_CHECK per call (most recent first), exactly once per
 * session (deduped via ai_job_runs `session.missed:<id>`).
 */
export async function checkMissedSessions(
  db: SupabaseClient,
  userId: string,
  preloaded?: LoadedPlan | null
): Promise<RunAdaptationResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const plan =
    preloaded !== undefined ? preloaded : ((await getCurrentPlan(db, userId)) as LoadedPlan | null);
  if (!plan) return [];

  const missed = findMissedSessions(plan, today).slice(-MISSED_SESSIONS_PER_CHECK);
  const results: RunAdaptationResult[] = [];
  for (const s of missed) {
    if (await hasJobRun(db, userId, `session.missed:${s.id}`)) continue;
    results.push(
      await runAdaptation(db, userId, { type: "session.missed", prescribed_session_id: s.id })
    );
  }
  return results;
}

/**
 * Fire `week.completed` for the most recently finished plan week, once per
 * week (deduped via `week.completed:<week_id>`). The classifier currently
 * yields a diff-less MAJOR (generate_week), which runAdaptation surfaces as a
 * notification — the scoped re-generation pipeline plugs in here later.
 */
export async function checkWeekCompleted(
  db: SupabaseClient,
  userId: string,
  preloaded?: LoadedPlan | null
): Promise<RunAdaptationResult | null> {
  const today = new Date().toISOString().slice(0, 10);
  const plan =
    preloaded !== undefined ? preloaded : ((await getCurrentPlan(db, userId)) as LoadedPlan | null);
  if (!plan) return null;

  const week = latestCompletedWeek(plan, today);
  if (!week) return null;
  if (await hasJobRun(db, userId, `week.completed:${week.id}`)) return null;

  return runAdaptation(db, userId, {
    type: "week.completed",
    week_index: week.week_index,
    week_id: week.id,
  });
}

// ─── runDailyChecks: the whole heartbeat in one call ──────────────────────────

export interface DailyChecksResult {
  missed: RunAdaptationResult[];
  week_completed: RunAdaptationResult | null;
  phase_ending: RunAdaptationResult | null;
}

/**
 * Run all rollover detectors off one plan load: missed sessions → week
 * completed → phase ending. Each check is error-isolated so one failure never
 * blocks the others (or the check-in that triggered the heartbeat).
 */
export async function runDailyChecks(
  db: SupabaseClient,
  userId: string
): Promise<DailyChecksResult> {
  const plan = (await getCurrentPlan(db, userId).catch(() => null)) as LoadedPlan | null;
  const result: DailyChecksResult = { missed: [], week_completed: null, phase_ending: null };
  if (!plan) return result;

  try {
    result.missed = await checkMissedSessions(db, userId, plan);
  } catch {
    /* isolated */
  }
  try {
    result.week_completed = await checkWeekCompleted(db, userId, plan);
  } catch {
    /* isolated */
  }
  try {
    result.phase_ending = await checkPhaseEnding(db, userId, plan);
  } catch {
    /* isolated */
  }
  return result;
}
