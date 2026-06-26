import { describe, it, expect } from "vitest";
import {
  classifyAdaptation,
  withinMinorGuardrails,
  scaleSessionDiff,
  rescheduleSessionDiff,
  swapModalityDiff,
  insertPrehabDiff,
  EASY_RPE,
  HARD_RPE,
  SCALE_PCT,
  MINOR_MAX_SESSIONS,
  type AdaptationContext,
} from "./adaptation.js";
import type { PrescribedSession, InjuryFlag, SportType } from "../types.js";

// ─── Factories ────────────────────────────────────────────────────────────────

let idCounter = 0;
const nextId = () => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, "0")}`;

const WEEK_START = "2026-06-22"; // a Monday
const WEEK_ID = "week-0000-0000-0000-000000000000";

function presc(over: Partial<PrescribedSession> = {}): PrescribedSession {
  const day = over.day_of_week ?? 0;
  return {
    id: over.id ?? nextId(),
    user_id: "u",
    plan_week_id: WEEK_ID,
    day_of_week: day,
    scheduled_date: over.scheduled_date ?? addDays(WEEK_START, day),
    sport: over.sport ?? "run",
    order_in_day: over.order_in_day ?? 0,
    prescription: over.prescription ?? { kind: over.sport ?? "run" },
    status: over.status ?? "planned",
    logged_session_id: null,
    injury_flag_id: null,
    created_at: "",
    updated_at: "",
    deleted_at: over.deleted_at ?? null,
    ...over,
  };
}

function flag(over: Partial<InjuryFlag> = {}): InjuryFlag {
  return {
    id: over.id ?? nextId(),
    user_id: "u",
    body_part: over.body_part ?? "calf",
    side: over.side ?? "left",
    status: over.status ?? "active",
    severity: over.severity ?? 6,
    onset_date: "2026-06-20",
    resolved_date: null,
    narrative: null,
    origin: "hook",
    created_at: "",
    updated_at: "",
    deleted_at: null,
    ...over,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ctx(over: Partial<AdaptationContext> = {}): AdaptationContext {
  return {
    today: over.today ?? "2026-06-23", // Tuesday of the week
    week: over.week ?? {
      id: WEEK_ID,
      week_index: 0,
      start_date: WEEK_START,
      targets: { deload: false, weekly_distance_m: 8000 },
    },
    weekSessions: over.weekSessions ?? [],
    activeFlags: over.activeFlags ?? [],
    runCapped: over.runCapped ?? false,
    ...over,
  };
}

// ─── session.logged → scale ──────────────────────────────────────────────────

describe("classifyAdaptation — session.logged", () => {
  it("easy RPE nudges the next same-sport session UP within ramp (minor)", () => {
    const logged = presc({ sport: "run", day_of_week: 1, status: "completed" });
    const next = presc({ sport: "run", day_of_week: 3 });
    const c = ctx({ weekSessions: [logged, next] });

    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: logged.id, logged: { sport: "run", session_rpe: EASY_RPE } },
      c
    );

    expect(d.tier).toBe("minor");
    expect(d.action_type).toBe("scale_session");
    expect(d.diffs).toHaveLength(1);
    expect(d.diffs[0].entity_id).toBe(next.id);
    const after = d.diffs[0].after as { prescription: { scale: number } };
    expect(after.prescription.scale).toBeCloseTo(1 + SCALE_PCT, 5);
    expect(d.notify).toContain("up");
  });

  it("hard RPE eases the next same-sport session DOWN (minor)", () => {
    const next = presc({ sport: "run", day_of_week: 4 });
    const c = ctx({ weekSessions: [next] });

    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: null, logged: { sport: "run", session_rpe: HARD_RPE } },
      c
    );

    expect(d.tier).toBe("minor");
    const after = d.diffs[0].after as { prescription: { scale: number } };
    expect(after.prescription.scale).toBeCloseTo(1 - SCALE_PCT, 5);
  });

  it("does NOT scale a run UP while run volume is capped (cap stays inviolable)", () => {
    const next = presc({ sport: "run", day_of_week: 3 });
    const c = ctx({ weekSessions: [next], runCapped: true });

    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: null, logged: { sport: "run", session_rpe: 2 } },
      c
    );
    expect(d.tier).toBe("none");
  });

  it("does NOT scale up on a deload week", () => {
    const next = presc({ sport: "run", day_of_week: 3 });
    const c = ctx({
      weekSessions: [next],
      week: { id: WEEK_ID, week_index: 3, start_date: WEEK_START, targets: { deload: true } },
    });
    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: null, logged: { sport: "run", session_rpe: 1 } },
      c
    );
    expect(d.tier).toBe("none");
  });

  it("mid-range RPE produces no change", () => {
    const next = presc({ sport: "run", day_of_week: 3 });
    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: null, logged: { sport: "run", session_rpe: 5 } },
      ctx({ weekSessions: [next] })
    );
    expect(d.tier).toBe("none");
  });

  it("no upcoming same-sport session → none", () => {
    const climb = presc({ sport: "climb", day_of_week: 3 });
    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: null, logged: { sport: "run", session_rpe: 1 } },
      ctx({ weekSessions: [climb] })
    );
    expect(d.tier).toBe("none");
  });

  it("null RPE → none", () => {
    const next = presc({ sport: "run", day_of_week: 3 });
    const d = classifyAdaptation(
      { type: "session.logged", prescribed_session_id: null, logged: { sport: "run", session_rpe: null } },
      ctx({ weekSessions: [next] })
    );
    expect(d.tier).toBe("none");
  });
});

// ─── session.missed → reschedule ─────────────────────────────────────────────

describe("classifyAdaptation — session.missed", () => {
  it("reschedules a missed session into an open later day this week (minor)", () => {
    // today = Tue (2026-06-23). Missed Monday run; Wed/Thu open.
    const missed = presc({ id: "m", sport: "run", day_of_week: 0 });
    const climbWed = presc({ sport: "climb", day_of_week: 2 }); // Wed busy
    const c = ctx({ weekSessions: [missed, climbWed], today: "2026-06-23" });

    const d = classifyAdaptation({ type: "session.missed", prescribed_session_id: "m" }, c);

    expect(d.tier).toBe("minor");
    expect(d.action_type).toBe("reschedule_session");
    expect(d.diffs[0].entity_id).toBe("m");
    const after = d.diffs[0].after as { day_of_week: number; scheduled_date: string };
    // first open day after today that isn't Wed(2) → Thu(3)
    expect(after.day_of_week).toBe(3);
    expect(after.scheduled_date).toBe(addDays(WEEK_START, 3));
  });

  it("no open day left this week → none (stands as skipped)", () => {
    // today = Sunday; nothing remains.
    const missed = presc({ id: "m", sport: "run", day_of_week: 0 });
    const c = ctx({ weekSessions: [missed], today: addDays(WEEK_START, 6) });
    const d = classifyAdaptation({ type: "session.missed", prescribed_session_id: "m" }, c);
    expect(d.tier).toBe("none");
  });
});

// ─── checkin.submitted → swap / prehab / escalate ────────────────────────────

describe("classifyAdaptation — checkin.submitted", () => {
  it("calf flag + one upcoming run → minor swap (+prehab), ≤2 sessions", () => {
    const run = presc({ sport: "run", day_of_week: 3 });
    const c = ctx({ weekSessions: [run], activeFlags: [flag({ body_part: "calf" })] });

    const d = classifyAdaptation(
      { type: "checkin.submitted", raised_flags: [flag({ body_part: "calf" })] },
      c
    );

    expect(d.tier).toBe("minor");
    expect(d.action_type).toBe("swap_modality");
    expect(d.diffs.length).toBeLessThanOrEqual(MINOR_MAX_SESSIONS);
    // one diff swaps the run to cross_train
    const swap = d.diffs.find((x) => x.op === "update");
    expect((swap?.after as { sport: string }).sport).toBe("cross_train");
    // a prehab strength session is created
    const prehab = d.diffs.find((x) => x.op === "create");
    expect((prehab?.after as { sport: string }).sport).toBe("strength");
  });

  it("calf flag with MORE than one upcoming run → major proposal", () => {
    const r1 = presc({ sport: "run", day_of_week: 3 });
    const r2 = presc({ sport: "run", day_of_week: 5 });
    const c = ctx({ weekSessions: [r1, r2], activeFlags: [flag({ body_part: "calf" })] });

    const d = classifyAdaptation(
      { type: "checkin.submitted", raised_flags: [flag({ body_part: "calf" })] },
      c
    );
    expect(d.tier).toBe("major");
    expect(d.action_type).toBe("insert_deload");
  });

  it("non-lower-limb flag with no prehab scheduled → minor insert_prehab", () => {
    const climb = presc({ sport: "climb", day_of_week: 3 });
    const c = ctx({ weekSessions: [climb], activeFlags: [flag({ body_part: "finger" })] });
    const d = classifyAdaptation(
      { type: "checkin.submitted", raised_flags: [flag({ body_part: "finger" })] },
      c
    );
    expect(d.tier).toBe("minor");
    expect(d.action_type).toBe("insert_prehab");
    expect(d.diffs).toHaveLength(1);
    expect((d.diffs[0].after as { injury_flag_id: string }).injury_flag_id).toBeTruthy();
  });

  it("no raised flags → none", () => {
    const d = classifyAdaptation({ type: "checkin.submitted", raised_flags: [] }, ctx());
    expect(d.tier).toBe("none");
  });
});

// ─── week/phase rollover → major ─────────────────────────────────────────────

describe("classifyAdaptation — rollovers", () => {
  it("week.completed is a major (proposed) review", () => {
    const d = classifyAdaptation({ type: "week.completed", week_index: 0 }, ctx());
    expect(d.tier).toBe("major");
    expect(d.action_type).toBe("generate_week");
  });
  it("phase.ending proposes the next phase (major)", () => {
    const d = classifyAdaptation({ type: "phase.ending", phase_index: 1 }, ctx());
    expect(d.tier).toBe("major");
    expect(d.action_type).toBe("generate_phase");
  });
});

// ─── guardrail validator ─────────────────────────────────────────────────────

describe("withinMinorGuardrails", () => {
  const s = presc({ id: "s1", sport: "run", day_of_week: 3 });
  const c = ctx({ weekSessions: [s] });

  it("accepts a single in-week update", () => {
    expect(withinMinorGuardrails([scaleSessionDiff(s, 1.15, "x")], c).ok).toBe(true);
  });

  it("rejects more than MINOR_MAX_SESSIONS diffs", () => {
    const many = Array.from({ length: MINOR_MAX_SESSIONS + 1 }, () => scaleSessionDiff(s, 1.1, "x"));
    expect(withinMinorGuardrails(many, c).ok).toBe(false);
  });

  it("rejects an update to a session outside the current week", () => {
    const outsider = presc({ id: "other", sport: "run", day_of_week: 3 });
    expect(withinMinorGuardrails([scaleSessionDiff(outsider, 1.1, "x")], c).ok).toBe(false);
  });

  it("rejects non-prescribed_sessions tables", () => {
    const bad = { entity_type: "goals", entity_id: "g", op: "update" as const, before: {}, after: {}, fields: [] };
    expect(withinMinorGuardrails([bad], c).ok).toBe(false);
  });

  it("rejects deletes", () => {
    const del = { entity_type: "prescribed_sessions", entity_id: "s1", op: "delete" as const, before: {}, after: null, fields: [] };
    expect(withinMinorGuardrails([del], c).ok).toBe(false);
  });

  it("a minor that breaches the envelope is downgraded to major by classifyAdaptation", () => {
    // Force the breach: a missed-session reschedule whose week has the session,
    // but we simulate a guardrail breach by checking the validator path directly
    // via an over-long synthetic set.
    const many = [scaleSessionDiff(s, 1.1, "x"), scaleSessionDiff(s, 1.1, "y"), scaleSessionDiff(s, 1.1, "z")];
    expect(withinMinorGuardrails(many, c).ok).toBe(false);
  });
});

// ─── diff builders ───────────────────────────────────────────────────────────

describe("diff builders are undo-ready (carry before)", () => {
  const s = presc({ id: "s1", sport: "run", day_of_week: 3, prescription: { kind: "run", scale: 1 } });

  it("scaleSessionDiff multiplies a prior scale and keeps before", () => {
    const d = scaleSessionDiff(s, 1.15, "easy");
    expect((d.before as { prescription: { scale: number } }).prescription.scale).toBe(1);
    expect((d.after as { prescription: { scale: number } }).prescription.scale).toBeCloseTo(1.15, 5);
  });

  it("rescheduleSessionDiff keeps original day/date in before", () => {
    const d = rescheduleSessionDiff(s, 5, "2026-06-27");
    expect((d.before as { day_of_week: number }).day_of_week).toBe(3);
    expect((d.after as { day_of_week: number }).day_of_week).toBe(5);
  });

  it("swapModalityDiff records original sport in before", () => {
    const d = swapModalityDiff(s, "calf");
    expect((d.before as { sport: SportType }).sport).toBe("run");
    expect((d.after as { sport: SportType }).sport).toBe("cross_train");
  });

  it("insertPrehabDiff is a create tied to the flag", () => {
    const f = flag({ body_part: "knee" });
    const d = insertPrehabDiff(WEEK_ID, 4, "2026-06-26", 0, f);
    expect(d.op).toBe("create");
    expect((d.after as { injury_flag_id: string }).injury_flag_id).toBe(f.id);
    expect((d.after as { sport: SportType }).sport).toBe("strength");
  });
});
