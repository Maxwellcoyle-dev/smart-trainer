import { describe, it, expect } from "vitest";
import { runAdaptation, resolveAutonomy, selectWeekContext } from "./adaptation.js";
import type { AdaptationContext, AdaptationEvent } from "../engine/adaptation.js";
import type { SupabaseClient } from "../db.js";
import type { PrescribedSession, InjuryFlag } from "../types.js";

// ─── resolveAutonomy ──────────────────────────────────────────────────────────

describe("resolveAutonomy", () => {
  it("defaults to balanced", () => {
    expect(resolveAutonomy(undefined)).toBe("balanced");
    expect(resolveAutonomy({})).toBe("balanced");
    expect(resolveAutonomy({ autonomy: "bogus" })).toBe("balanced");
  });
  it("honours conservative", () => {
    expect(resolveAutonomy({ autonomy: "conservative" })).toBe("conservative");
  });
});

// ─── selectWeekContext (pure week selection) ──────────────────────────────────

function presc(over: Partial<PrescribedSession>): PrescribedSession {
  return {
    id: over.id ?? "p",
    user_id: "u",
    plan_week_id: over.plan_week_id ?? "w0",
    day_of_week: over.day_of_week ?? 0,
    scheduled_date: over.scheduled_date ?? null,
    sport: over.sport ?? "run",
    order_in_day: 0,
    prescription: {},
    status: over.status ?? "planned",
    logged_session_id: null,
    injury_flag_id: null,
    created_at: "",
    updated_at: "",
    deleted_at: over.deleted_at ?? null,
    ...over,
  };
}

function makePlan(weeks: { id: string; start: string; sessions: PrescribedSession[] }[]) {
  return {
    id: "plan",
    user_id: "u",
    name: "P",
    status: "active",
    start_date: weeks[0]?.start ?? null,
    end_date: null,
    intent: null,
    created_at: "",
    updated_at: "",
    deleted_at: null,
    phases: [
      {
        id: "ph",
        plan_weeks: weeks.map((w, i) => ({
          id: w.id,
          week_index: i,
          start_date: w.start,
          targets: {},
          prescribed_sessions: w.sessions,
        })),
      },
    ],
  } as unknown as Parameters<typeof selectWeekContext>[0];
}

describe("selectWeekContext", () => {
  const plan = makePlan([
    { id: "w0", start: "2026-06-15", sessions: [presc({ id: "a", plan_week_id: "w0" })] },
    { id: "w1", start: "2026-06-22", sessions: [presc({ id: "b", plan_week_id: "w1" })] },
  ]);

  it("picks the week containing today", () => {
    const c = selectWeekContext(plan, [], { type: "week.completed", week_index: 1 } as AdaptationEvent, "2026-06-24");
    // week.completed prefers the named index → w1
    expect(c?.week.id).toBe("w1");
  });

  it("picks the week owning a named session", () => {
    const ev: AdaptationEvent = { type: "session.missed", prescribed_session_id: "a" };
    const c = selectWeekContext(plan, [], ev, "2026-06-24");
    expect(c?.week.id).toBe("w0");
  });

  it("sets runCapped when a lower-limb flag is active", () => {
    const flags = [{ body_part: "calf", status: "active" } as InjuryFlag];
    const c = selectWeekContext(plan, flags, { type: "week.completed", week_index: 0 } as AdaptationEvent, "2026-06-16");
    expect(c?.runCapped).toBe(true);
  });
});

// ─── runAdaptation with a fake Supabase (autonomy branching) ──────────────────

interface Recorded {
  ai_job_runs: Record<string, unknown>[];
  adaptation_logs: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  updates: { table: string; values: Record<string, unknown> }[];
}

/** Minimal chainable fake covering the calls runAdaptation makes. */
function fakeDb(rec: Recorded): SupabaseClient {
  let n = 0;
  const handler = (table: string) => {
    const builder: Record<string, unknown> = {};
    let lastInsert: Record<string, unknown> | null = null;
    const chain = () => builder;
    builder.insert = (vals: Record<string, unknown>) => {
      lastInsert = vals;
      if (table in rec) (rec as unknown as Record<string, Record<string, unknown>[]>)[table].push(vals);
      return builder;
    };
    builder.update = (vals: Record<string, unknown>) => {
      rec.updates.push({ table, values: vals });
      return builder;
    };
    builder.select = chain;
    builder.eq = chain;
    builder.single = async () => ({ data: { id: `${table}-${++n}`, ...(lastInsert ?? {}) }, error: null });
    builder.maybeSingle = async () => ({ data: null, error: null });
    // make .eq().eq() awaitable for update paths
    (builder as { then?: unknown }).then = undefined;
    return builder;
  };
  return { from: handler } as unknown as SupabaseClient;
}

const WEEK_ID = "w0";
function minorCtx(): AdaptationContext {
  // calf flag + one upcoming run → minor swap (+prehab)
  return {
    today: "2026-06-23",
    week: { id: WEEK_ID, week_index: 0, start_date: "2026-06-22", targets: { deload: false } },
    weekSessions: [presc({ id: "r1", plan_week_id: WEEK_ID, sport: "run", day_of_week: 3, scheduled_date: "2026-06-25" })],
    activeFlags: [{ id: "f1", body_part: "calf", status: "active" } as InjuryFlag],
    runCapped: true,
  };
}

const calfCheckin: AdaptationEvent = {
  type: "checkin.submitted",
  raised_flags: [{ id: "f1", body_part: "calf", status: "active" } as InjuryFlag],
};

describe("runAdaptation — autonomy branching", () => {
  it("balanced auto-applies a minor (logs it, no proposal)", async () => {
    const rec: Recorded = { ai_job_runs: [], adaptation_logs: [], proposals: [], updates: [] };
    const db = fakeDb(rec);
    const res = await runAdaptation(db, "u", calfCheckin, { context: minorCtx(), autonomy: "balanced" });

    expect(res.outcome).toBe("applied");
    expect(res.decision.tier).toBe("minor");
    expect(res.log_id).toBeTruthy();
    expect(res.notify).toBeTruthy();
    expect(rec.adaptation_logs).toHaveLength(1);
    expect(rec.adaptation_logs[0].source).toBe("hook");
    expect(rec.proposals).toHaveLength(0);
    expect(rec.ai_job_runs).toHaveLength(1); // one job recorded
  });

  it("conservative proposes the same minor instead of applying it", async () => {
    const rec: Recorded = { ai_job_runs: [], adaptation_logs: [], proposals: [], updates: [] };
    const db = fakeDb(rec);
    const res = await runAdaptation(db, "u", calfCheckin, { context: minorCtx(), autonomy: "conservative" });

    expect(res.outcome).toBe("proposed");
    expect(res.proposal).toBeTruthy();
    expect(rec.adaptation_logs).toHaveLength(0);
    expect(rec.proposals).toHaveLength(1);
    expect(rec.proposals[0].status).toBe("pending");
  });

  it("a 'none' decision is skipped and audited", async () => {
    const rec: Recorded = { ai_job_runs: [], adaptation_logs: [], proposals: [], updates: [] };
    const db = fakeDb(rec);
    const noFlags: AdaptationEvent = { type: "checkin.submitted", raised_flags: [] };
    const res = await runAdaptation(db, "u", noFlags, { context: minorCtx(), autonomy: "balanced" });

    expect(res.outcome).toBe("skipped");
    expect(rec.adaptation_logs).toHaveLength(0);
    expect(rec.proposals).toHaveLength(0);
    // job still finished (one insert, one status update)
    expect(rec.ai_job_runs).toHaveLength(1);
  });
});
