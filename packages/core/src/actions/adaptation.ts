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
import { getCurrentPlan, getInjuryFlags, getProfile } from "./reads.js";
import { LOWER_LIMB_PARTS } from "../engine/periodization.js";
import {
  classifyAdaptation,
  type AdaptationContext,
  type AdaptationDecision,
  type AdaptationEvent,
} from "../engine/adaptation.js";
import type {
  AdaptationDiff,
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

type LoadedPlan = Plan & {
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
  today: string
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
  const jobId = await startJob(db, userId, "adaptation", event.type);

  try {
    // Build context (unless the caller supplied one, e.g. tests).
    let ctx = opts.context ?? null;
    let autonomy = opts.autonomy;

    if (!ctx || autonomy == null) {
      const [plan, flags, profile] = await Promise.all([
        getCurrentPlan(db, userId) as Promise<LoadedPlan | null>,
        getInjuryFlags(db, userId),
        getProfile(db, userId),
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
        ctx = selectWeekContext(plan, flags, event, today);
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

    // A major with no concrete diffs (week/phase rollover) has nothing to apply
    // yet — the scoped re-generation pipeline (G3) isn't built. Surface it as a
    // notification rather than queuing a dead, un-actionable proposal. (These
    // events are not emitted in v1; this guard keeps the path safe if they are.)
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
