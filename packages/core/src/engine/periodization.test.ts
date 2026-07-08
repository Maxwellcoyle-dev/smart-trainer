import { describe, it, expect } from "vitest";
import type { Availability, Goal, InjuryFlag } from "../types.js";
import {
  RAMP_MAX_PCT,
  DELOAD_EVERY_WEEKS,
  BASE_GATE_RUN_CAP_M,
  allocatePhases,
  pickSpacedDays,
  mapAvailabilityToSlots,
  computeWeeklyTargets,
  applyInjuryCaps,
  evaluateBaseGate,
  pickSpine,
  generateMacroPlan,
  generatePlanDiffs,
  weeksBetween,
  mondayOnOrBefore,
  assessEventFeasibility,
  type PeriodizationInput,
} from "./periodization.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = "2026-06-22"; // a Monday

function goal(over: Partial<Goal>): Goal {
  return {
    id: over.id ?? "g-" + Math.random().toString(36).slice(2),
    user_id: "u1",
    kind: "event",
    sport: "run",
    title: "Goal",
    target_date: null,
    target: {},
    priority: 1,
    status: "active",
    notes: null,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...over,
  };
}

function flag(over: Partial<InjuryFlag>): InjuryFlag {
  return {
    id: over.id ?? "f-" + Math.random().toString(36).slice(2),
    user_id: "u1",
    body_part: "calf",
    side: "left",
    status: "active",
    severity: 6,
    onset_date: NOW,
    resolved_date: null,
    narrative: null,
    origin: "hook",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...over,
  };
}

const AVAIL: Availability = {
  days_per_week: 5,
  hours_per_day: 1.5,
  blackout_dow: [],
  per_sport: {
    run: { max_days: 3, min_rest_days_between: 2 },
    climb: { max_days: 2, min_rest_days_between: 1, allow_back_to_back: true },
    strength: { max_days: 2, min_rest_days_between: 0 },
  },
};

function baseInput(over: Partial<PeriodizationInput> = {}): PeriodizationInput {
  return {
    today: NOW,
    goals: [
      goal({ id: "half", title: "Trail half", target_date: "2026-10-12", priority: 1, target: { metric: "distance", value: 21097, unit: "m", by_date: "2026-10-12" } }),
    ],
    availability: AVAIL,
    capacity: { weekly_distance_m: 12000 },
    activeFlags: [],
    ...over,
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

describe("date helpers", () => {
  it("mondayOnOrBefore snaps to Monday", () => {
    expect(mondayOnOrBefore("2026-06-24")).toBe("2026-06-22"); // Wed → Mon
    expect(mondayOnOrBefore("2026-06-22")).toBe("2026-06-22"); // Mon → same
    expect(mondayOnOrBefore("2026-06-21")).toBe("2026-06-15"); // Sun → prev Mon
  });

  it("weeksBetween floors and never goes negative", () => {
    expect(weeksBetween("2026-06-22", "2026-10-12")).toBe(16);
    expect(weeksBetween("2026-10-12", "2026-06-22")).toBe(0);
  });
});

// ─── Phase allocation ─────────────────────────────────────────────────────────

describe("allocatePhases", () => {
  it("collapses short plans to a single base block", () => {
    const p = allocatePhases(4);
    expect(p).toHaveLength(1);
    expect(p[0].type).toBe("base");
    expect(p[0].weeks).toBe(4);
  });

  it("allocates base→build→peak→taper and sums to total", () => {
    const total = 16;
    const p = allocatePhases(total);
    expect(p.map((x) => x.type)).toEqual(["base", "build", "peak", "taper"]);
    expect(p.reduce((s, x) => s + x.weeks, 0)).toBe(total);
    p.forEach((x) => expect(x.weeks).toBeGreaterThanOrEqual(1));
  });

  it("base is the largest phase and taper the smallest", () => {
    const p = allocatePhases(16);
    const byType = Object.fromEntries(p.map((x) => [x.type, x.weeks]));
    expect(byType.base).toBeGreaterThanOrEqual(byType.build);
    expect(byType.taper).toBeLessThanOrEqual(byType.peak);
  });

  it("sums to total across a range of plan lengths", () => {
    for (let n = 5; n <= 40; n++) {
      const p = allocatePhases(n);
      expect(p.reduce((s, x) => s + x.weeks, 0)).toBe(n);
      p.forEach((x) => expect(x.weeks).toBeGreaterThanOrEqual(1));
    }
  });
});

// ─── Ramp guardrail ───────────────────────────────────────────────────────────

describe("computeWeeklyTargets — ramp guardrail", () => {
  const weeks = Array.from({ length: 12 }, () => ({ phaseType: "build" as const }));

  it("never increases weekly volume by more than RAMP_MAX_PCT between progression weeks", () => {
    const t = computeWeeklyTargets(weeks, {
      startVolumeM: 10000,
      runWeeklyCapM: null,
      runSessions: 3,
      climbSessions: 0,
      strengthSessions: 0,
    });
    // Compare consecutive non-deload (progression) weeks only.
    let prev: number | null = null;
    t.forEach((w) => {
      if (w.deload) return;
      if (prev !== null && w.weekly_distance_m > prev) {
        const ratio = w.weekly_distance_m / prev;
        expect(ratio).toBeLessThanOrEqual(1 + RAMP_MAX_PCT + 1e-9);
      }
      prev = w.weekly_distance_m;
    });
  });

  it("week 1 holds starting volume (no jump)", () => {
    const t = computeWeeklyTargets(weeks, {
      startVolumeM: 10000,
      runWeeklyCapM: null,
      runSessions: 3,
      climbSessions: 0,
      strengthSessions: 0,
    });
    expect(t[0].weekly_distance_m).toBe(10000);
  });
});

// ─── Deload guardrail ─────────────────────────────────────────────────────────

describe("computeWeeklyTargets — deload cadence", () => {
  it("places a deload at least every DELOAD_EVERY_WEEKS weeks", () => {
    const weeks = Array.from({ length: 12 }, () => ({ phaseType: "build" as const }));
    const t = computeWeeklyTargets(weeks, {
      startVolumeM: 10000,
      runWeeklyCapM: null,
      runSessions: 3,
      climbSessions: 0,
      strengthSessions: 0,
    });
    let sinceDeload = 0;
    t.forEach((w) => {
      sinceDeload = w.deload ? 0 : sinceDeload + 1;
      expect(sinceDeload).toBeLessThanOrEqual(DELOAD_EVERY_WEEKS);
    });
  });

  it("deload week drops volume below the prior progression week", () => {
    const weeks = Array.from({ length: 4 }, () => ({ phaseType: "build" as const }));
    const t = computeWeeklyTargets(weeks, {
      startVolumeM: 10000,
      runWeeklyCapM: null,
      runSessions: 3,
      climbSessions: 0,
      strengthSessions: 0,
    });
    // index 3 (4th week) is the deload
    expect(t[3].deload).toBe(true);
    expect(t[3].weekly_distance_m).toBeLessThan(t[2].weekly_distance_m);
  });

  it("taper weeks are never marked deload but still reduce from peak", () => {
    const weeks = [
      { phaseType: "build" as const },
      { phaseType: "build" as const },
      { phaseType: "taper" as const },
      { phaseType: "taper" as const },
    ];
    const t = computeWeeklyTargets(weeks, {
      startVolumeM: 10000,
      runWeeklyCapM: null,
      runSessions: 3,
      climbSessions: 0,
      strengthSessions: 0,
    });
    expect(t[2].deload).toBe(false);
    expect(t[3].deload).toBe(false);
    expect(t[3].weekly_distance_m).toBeLessThan(t[1].weekly_distance_m);
  });
});

// ─── Injury cap guardrail ─────────────────────────────────────────────────────

describe("run cap while a lower-limb flag is active", () => {
  it("computeWeeklyTargets clamps every week to the cap", () => {
    const weeks = Array.from({ length: 8 }, () => ({ phaseType: "build" as const }));
    const t = computeWeeklyTargets(weeks, {
      startVolumeM: 12000,
      runWeeklyCapM: BASE_GATE_RUN_CAP_M,
      runSessions: 3,
      climbSessions: 0,
      strengthSessions: 0,
    });
    t.forEach((w) => expect(w.weekly_distance_m).toBeLessThanOrEqual(BASE_GATE_RUN_CAP_M));
  });

  it("whole-plan generation caps run volume when a calf flag is active", () => {
    const macro = generateMacroPlan(baseInput({ activeFlags: [flag({ body_part: "calf" })] }));
    macro.phases.forEach((p) =>
      p.weeks.forEach((w) =>
        expect(w.targets.weekly_distance_m).toBeLessThanOrEqual(BASE_GATE_RUN_CAP_M)
      )
    );
  });

  it("applyInjuryCaps swaps a run for cross-training and ensures a prehab slot", () => {
    const slots = [
      { day_of_week: 0, sport: "run" as const, order_in_day: 0 },
      { day_of_week: 3, sport: "run" as const, order_in_day: 0 },
      { day_of_week: 5, sport: "climb" as const, order_in_day: 0 },
    ];
    const out = applyInjuryCaps(slots, [flag({ body_part: "calf" })]);
    expect(out.some((s) => s.sport === "cross_train")).toBe(true);
    expect(out.some((s) => s.sport === "strength")).toBe(true);
    // At least one run was removed (swapped).
    expect(out.filter((s) => s.sport === "run").length).toBeLessThan(2);
  });

  it("applyInjuryCaps is a no-op when no lower-limb flag is active", () => {
    const slots = [{ day_of_week: 0, sport: "run" as const, order_in_day: 0 }];
    const out = applyInjuryCaps(slots, [flag({ body_part: "shoulder", status: "active" })]);
    expect(out).toEqual(slots);
  });
});

// ─── Rest-spacing guardrail ───────────────────────────────────────────────────

describe("slot scaffold — rest spacing", () => {
  it("pickSpacedDays honors the minimum gap", () => {
    const days = pickSpacedDays(3, 2, [0, 1, 2, 3, 4, 5, 6]);
    expect(days).toEqual([0, 3, 6]);
    for (let i = 1; i < days.length; i++) {
      expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps runs at least 2 rest days apart in the generated week pattern", () => {
    const slots = mapAvailabilityToSlots(AVAIL);
    const runDays = slots.filter((s) => s.sport === "run").map((s) => s.day_of_week).sort((a, b) => a - b);
    expect(runDays.length).toBe(3);
    for (let i = 1; i < runDays.length; i++) {
      expect(runDays[i] - runDays[i - 1]).toBeGreaterThanOrEqual(3); // 2 rest days
    }
  });

  it("respects blackout days", () => {
    const av: Availability = { ...AVAIL, blackout_dow: [0, 6] };
    const slots = mapAvailabilityToSlots(av);
    slots.forEach((s) => expect([0, 6]).not.toContain(s.day_of_week));
  });
});

// ─── Base-building gate ───────────────────────────────────────────────────────

describe("base-building gate", () => {
  const gating = goal({ id: "base", kind: "process", title: "Injury-free base", priority: 1 });
  const gated = goal({ id: "half", title: "Trail half", target_date: "2026-10-12", priority: 2 });

  it("closes the gate while a lower-limb flag is active", () => {
    const g = evaluateBaseGate(gating, gated, [flag({ body_part: "calf" })]);
    expect(g.cleared).toBe(false);
  });

  it("opens the gate when lower-limb parts have cleared enough check-ins", () => {
    const g = evaluateBaseGate(gating, gated, [], {
      calf: 3,
      achilles: 3,
      knee: 3,
      ankle: 3,
      foot: 3,
    });
    expect(g.cleared).toBe(true);
  });

  it("stays closed when clear-check-in history is insufficient", () => {
    const g = evaluateBaseGate(gating, gated, [], { calf: 1 });
    expect(g.cleared).toBe(false);
  });

  it("pickSpine wires the gating process goal via gated_by", () => {
    const spine = pickSpine([
      goal({ id: "base", kind: "process", title: "Injury-free base", priority: 1 }),
      goal({
        id: "half",
        title: "Trail half",
        target_date: "2026-10-12",
        priority: 2,
        target: { metric: "distance", value: 21097, by_date: "2026-10-12", gated_by: ["base"] },
      }),
    ]);
    expect(spine?.primary.id).toBe("half");
    expect(spine?.gating?.id).toBe("base");
  });
});

// ─── End-to-end macro-plan ────────────────────────────────────────────────────

describe("generateMacroPlan", () => {
  it("produces a contiguous plan whose weeks count matches the timeline", () => {
    const macro = generateMacroPlan(baseInput());
    const totalFromPhases = macro.phases.reduce((s, p) => s + p.weeks.length, 0);
    expect(macro.total_weeks).toBe(totalFromPhases);
    // Global week indices are contiguous 0..n-1.
    const idxs = macro.phases.flatMap((p) => p.weeks.map((w) => w.week_index));
    expect(idxs).toEqual(Array.from({ length: idxs.length }, (_, i) => i));
  });

  it("week start dates step by 7 days from a Monday", () => {
    const macro = generateMacroPlan(baseInput());
    expect(macro.start_date).toBe("2026-06-22");
    const allWeeks = macro.phases.flatMap((p) => p.weeks);
    for (let i = 1; i < allWeeks.length; i++) {
      const prev = new Date(allWeeks[i - 1].start_date + "T00:00:00Z").getTime();
      const cur = new Date(allWeeks[i].start_date + "T00:00:00Z").getTime();
      expect((cur - prev) / 86_400_000).toBe(7);
    }
  });

  it("surfaces a flagged feasibility assumption when the gate is closed", () => {
    const macro = generateMacroPlan(
      baseInput({
        goals: [
          goal({ id: "base", kind: "process", title: "Injury-free base", priority: 1 }),
          goal({
            id: "half",
            title: "Trail half",
            target_date: "2026-10-12",
            priority: 2,
            target: { metric: "distance", value: 21097, by_date: "2026-10-12", gated_by: ["base"] },
          }),
        ],
        activeFlags: [flag({ body_part: "calf" })],
      })
    );
    expect(macro.gate?.cleared).toBe(false);
    expect(macro.flagged_assumptions.length).toBeGreaterThan(0);
  });

  it("falls back to an 8-week base block with no dated goal", () => {
    const macro = generateMacroPlan(baseInput({ goals: [goal({ kind: "process", title: "Stay healthy", target_date: null })] }));
    expect(macro.total_weeks).toBe(8);
    expect(macro.phases[0].type).toBe("base");
  });
});

// ─── Diff emission ────────────────────────────────────────────────────────────

describe("generatePlanDiffs", () => {
  it("emits plan → phases → weeks → sessions in order with placeholder refs", () => {
    const macro = generateMacroPlan(baseInput());
    const diffs = generatePlanDiffs(macro);

    expect(diffs[0].entity_type).toBe("plans");
    expect(diffs[0].op).toBe("create");

    // Every phase references the plan token.
    diffs
      .filter((d) => d.entity_type === "phases")
      .forEach((d) => expect(d.after?.plan_id).toBe("@plan"));

    // Every plan_week references a phase token.
    diffs
      .filter((d) => d.entity_type === "plan_weeks")
      .forEach((d) => expect(String(d.after?.phase_id)).toMatch(/^@phase:\d+$/));

    // Every prescribed_session references a week token and is appliable.
    const sessions = diffs.filter((d) => d.entity_type === "prescribed_sessions");
    expect(sessions.length).toBeGreaterThan(0);
    sessions.forEach((d) => expect(String(d.after?.plan_week_id)).toMatch(/^@week:\d+$/));
  });

  it("all emitted diffs target appliable tables", () => {
    const allowed = new Set(["plans", "phases", "plan_weeks", "prescribed_sessions"]);
    const diffs = generatePlanDiffs(generateMacroPlan(baseInput()));
    diffs.forEach((d) => expect(allowed.has(d.entity_type)).toBe(true));
  });
});

// ─── assessEventFeasibility (G5) ─────────────────────────────────────────────

describe("assessEventFeasibility (G5)", () => {
  const goal = { id: "g1", title: "Trail half marathon", target_date: "2026-10-31" };

  it("plenty of runway + healthy volume → on_track", () => {
    const r = assessEventFeasibility({
      today: "2026-01-01",
      goal,
      gateClosed: false,
      weeklyDistanceM: 20_000,
    });
    expect(r.status).toBe("on_track");
    expect(r.weeks_needed).not.toBeNull();
    expect(r.weeks_available).toBeGreaterThan(r.weeks_needed!);
  });

  it("gate closed near the date → projection starts from the gate cap and goes at_risk/infeasible", () => {
    const r = assessEventFeasibility({
      today: "2026-09-01",
      goal,
      gateClosed: true,
      weeklyDistanceM: 20_000, // ignored: gate closed forces the cap as the starting point
    });
    expect(["at_risk", "infeasible"]).toContain(r.status);
    expect(r.gate_closed).toBe(true);
    expect(r.note).toContain("CLOSED");
  });

  it("no dated goal → no_dated_goal", () => {
    const r = assessEventFeasibility({
      today: "2026-01-01",
      goal: null,
      gateClosed: false,
      weeklyDistanceM: 0,
    });
    expect(r.status).toBe("no_dated_goal");
  });

  it("date already passed → infeasible (zero weeks available)", () => {
    const r = assessEventFeasibility({
      today: "2026-11-15",
      goal,
      gateClosed: false,
      weeklyDistanceM: 2_400,
    });
    expect(r.status).toBe("infeasible");
    expect(r.weeks_available).toBe(0);
  });
});
