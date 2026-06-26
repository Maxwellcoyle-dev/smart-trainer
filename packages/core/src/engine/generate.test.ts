import { describe, it, expect } from "vitest";
import type { Availability, Goal, InjuryFlag } from "../types.js";
import {
  generateMacroPlan,
  generatePlanDiffs,
  type PeriodizationInput,
} from "./periodization.js";
import {
  resolvePlanDiffRefs,
  mergePersonalization,
  validateGeneratedPlan,
  type PlanPersonalization,
} from "./generate.js";

const NOW = "2026-06-22"; // Monday

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
      goal({
        id: "half",
        title: "Trail half",
        target_date: "2026-10-12",
        priority: 1,
        target: { metric: "distance", value: 21097, unit: "m", by_date: "2026-10-12" },
      }),
    ],
    availability: AVAIL,
    capacity: { weekly_distance_m: 12000 },
    activeFlags: [],
    ...over,
  };
}

// Deterministic id generator for assertions.
function seqIdGen() {
  let n = 0;
  return () => `id-${n++}`;
}

describe("resolvePlanDiffRefs", () => {
  it("replaces every @plan/@phase/@week token with a concrete id", () => {
    const macro = generateMacroPlan(baseInput());
    const diffs = generatePlanDiffs(macro);
    const resolved = resolvePlanDiffRefs(diffs, seqIdGen());

    // No token survives anywhere.
    for (const d of resolved) {
      for (const v of Object.values(d.after ?? {})) {
        expect(typeof v === "string" && v.startsWith("@")).toBe(false);
      }
    }
  });

  it("wires child FKs to their parent's assigned id", () => {
    const macro = generateMacroPlan(baseInput());
    const diffs = generatePlanDiffs(macro);
    const resolved = resolvePlanDiffRefs(diffs, seqIdGen());

    const plan = resolved.find((d) => d.entity_type === "plans")!;
    const phase = resolved.find((d) => d.entity_type === "phases")!;
    const week = resolved.find((d) => d.entity_type === "plan_weeks")!;
    const session = resolved.find((d) => d.entity_type === "prescribed_sessions")!;

    expect(plan.entity_id).toBeTruthy();
    expect((phase.after as Record<string, unknown>).plan_id).toBe(plan.entity_id);
    // The week's phase_id points at *some* created phase id.
    const phaseIds = resolved.filter((d) => d.entity_type === "phases").map((d) => d.entity_id);
    expect(phaseIds).toContain((week.after as Record<string, unknown>).phase_id);
    const weekIds = resolved.filter((d) => d.entity_type === "plan_weeks").map((d) => d.entity_id);
    expect(weekIds).toContain((session.after as Record<string, unknown>).plan_week_id);
  });

  it("every created row gets an explicit entity_id", () => {
    const macro = generateMacroPlan(baseInput());
    const diffs = generatePlanDiffs(macro);
    const resolved = resolvePlanDiffRefs(diffs, seqIdGen());
    for (const d of resolved) {
      if (d.op === "create") expect(d.entity_id).toBeTruthy();
    }
  });
});

describe("mergePersonalization", () => {
  it("applies phase themes and per-sport prescription detail without altering structure", () => {
    const macro = generateMacroPlan(baseInput());
    const diffs = generatePlanDiffs(macro);

    const personalization: PlanPersonalization = {
      phases: macro.phases.map((p) => ({
        phase_index: p.phase_index,
        theme: `Theme ${p.phase_index}`,
        prescriptions: { run: "easy run/walk", strength: "soleus eccentrics" },
      })),
    };

    const merged = mergePersonalization(diffs, personalization, macro);

    // Same number/kind of diffs (no structural change).
    expect(merged.length).toBe(diffs.length);
    expect(merged.map((d) => d.entity_type)).toEqual(diffs.map((d) => d.entity_type));

    const runSession = merged.find(
      (d) => d.entity_type === "prescribed_sessions" && (d.after as Record<string, unknown>).sport === "run"
    );
    expect(((runSession!.after as Record<string, unknown>).prescription as Record<string, unknown>).detail).toBe(
      "easy run/walk"
    );

    const week = merged.find((d) => d.entity_type === "plan_weeks")!;
    expect(typeof (week.after as Record<string, unknown>).theme).toBe("string");
  });

  it("never overwrites a deload week's theme", () => {
    const macro = generateMacroPlan(baseInput());
    const diffs = generatePlanDiffs(macro);
    const personalization: PlanPersonalization = {
      phases: macro.phases.map((p) => ({ phase_index: p.phase_index, theme: "OVERRIDE" })),
    };
    const merged = mergePersonalization(diffs, personalization, macro);
    const deloadWeeks = merged.filter(
      (d) => d.entity_type === "plan_weeks" && String((d.after as Record<string, unknown>).theme).includes("deload")
    );
    for (const w of deloadWeeks) {
      expect((w.after as Record<string, unknown>).theme).not.toBe("OVERRIDE");
    }
  });
});

describe("validateGeneratedPlan", () => {
  it("passes a clean engine-produced plan", () => {
    const input = baseInput();
    const macro = generateMacroPlan(input);
    expect(validateGeneratedPlan(macro, input).ok).toBe(true);
  });

  it("flags a ramp violation introduced after the fact", () => {
    const input = baseInput();
    const macro = generateMacroPlan(input);
    // Tamper: blow up a non-deload week's volume well past the ramp cap.
    const weeks = macro.phases.flatMap((p) => p.weeks);
    const target = weeks.find((w) => !w.targets.deload && w.week_index > 0)!;
    target.targets.weekly_distance_m = 999999;
    const res = validateGeneratedPlan(macro, input);
    expect(res.ok).toBe(false);
    expect(res.violations.join(" ")).toMatch(/ramp cap/);
  });

  it("flags run volume above the cap while a calf flag is active", () => {
    const input = baseInput({ activeFlags: [flag({ body_part: "calf", status: "active" })] });
    const macro = generateMacroPlan(input);
    const weeks = macro.phases.flatMap((p) => p.weeks);
    weeks[0].targets.weekly_distance_m = 50000; // way over the gated cap
    const res = validateGeneratedPlan(macro, input);
    expect(res.ok).toBe(false);
    expect(res.violations.join(" ")).toMatch(/cap/);
  });
});
