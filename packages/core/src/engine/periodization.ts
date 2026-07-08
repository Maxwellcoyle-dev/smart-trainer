/**
 * Stage 1 — Deterministic periodization engine.
 *
 * Pure module: NO LLM, NO DB. Given goals + availability + capacity + active
 * injury flags + today's date, it produces the *macro-plan* — phases, per-week
 * targets, and a weekly slot scaffold — as a structured object, and can emit it
 * as the standard `AdaptationDiff` array consumed by the apply engine.
 *
 * This is where the sports-science guardrails live and are unit-tested:
 *   • volume ramp never exceeds RAMP_MAX_PCT (10%) week-over-week
 *   • a deload week lands at least every DELOAD_EVERY_WEEKS (≤4)
 *   • run volume/intensity is capped while a lower-limb flag is active
 *   • run-distance progression is gated by the base-building gate
 *
 * The LLM (Stage 2) personalizes *inside* this envelope and may not change any
 * of the numbers this module sets. See ai-curriculum-design.md §4.
 */

import type {
  AdaptationDiff,
  Availability,
  BodyPart,
  Goal,
  GoalTarget,
  InjuryFlag,
  PhaseType,
  SportType,
} from "../types.js";
import { RESOLVE_AFTER_CLEAR_CHECKINS } from "../actions/policy.js";

// ─── Tunable constants (the guardrails) ───────────────────────────────────────

/** Max week-over-week volume increase between progression weeks. */
export const RAMP_MAX_PCT = 0.1;

/** A deload week must land at least this often (every Nth week). */
export const DELOAD_EVERY_WEEKS = 4;

/** Deload weeks step volume down by this fraction of the prior build volume. */
export const DELOAD_REDUCTION = 0.35;

/** Run volume cap (metres) while the base-building gate is closed — ~1.5 mi. */
export const BASE_GATE_RUN_CAP_M = 2400;

/** Per-session run cap (metres) while a lower-limb flag is active — ~1.5 mi. */
export const INJURY_RUN_WEEKLY_CAP_M = 4800;

/** Lower-limb body parts whose active flags cap running + drive the base gate. */
export const LOWER_LIMB_PARTS: BodyPart[] = ["calf", "achilles", "knee", "ankle", "foot"];

/** Taper weeks scale the peak volume down by these factors, in order. */
export const TAPER_FACTORS = [0.8, 0.6];

/** Default phase-length preference (profile "6–12 week phases"). */
export const DEFAULT_MIN_PHASE_WEEKS = 3;
export const DEFAULT_MAX_PHASE_WEEKS = 12;

const MS_PER_DAY = 86_400_000;

// ─── Input types ──────────────────────────────────────────────────────────────

// Availability, PerSportAvailability and GoalTarget are now defined canonically
// in ../types.js (with Zod schemas) and imported above.

/** Current capacity, derived from profile + recent metric views. */
export interface Capacity {
  /** Current weekly running volume (metres), e.g. from getWeeklyMileage. */
  weekly_distance_m: number;
  longest_run_m?: number;
}

export interface PeriodizationInput {
  today: string; // ISO date (YYYY-MM-DD)
  goals: Goal[]; // active goals; target read via readGoalTarget()
  availability: Availability;
  capacity: Capacity;
  /** Open injury flags (status != resolved). */
  activeFlags: InjuryFlag[];
  /**
   * Consecutive clear check-ins per body part, used to evaluate the base gate.
   * A part with >= RESOLVE_AFTER_CLEAR_CHECKINS clear check-ins is "cleared".
   */
  clearCheckinsByPart?: Partial<Record<BodyPart, number>>;
  preferences?: {
    min_phase_weeks?: number;
    max_phase_weeks?: number;
  };
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface WeekTargets {
  weekly_distance_m: number;
  run_sessions: number;
  climb_sessions: number;
  strength_sessions: number;
  deload: boolean;
  intensity: "easy" | "moderate" | "hard";
  [k: string]: unknown; // stored as plan_weeks.targets JSONB
}

export interface SlotPlan {
  day_of_week: number; // 0 = Mon
  sport: SportType;
  order_in_day: number;
  hint?: string;
}

export interface MacroWeek {
  week_index: number; // global, 0-based across the whole plan
  start_date: string;
  theme?: string;
  targets: WeekTargets;
  slots: SlotPlan[];
}

export interface MacroPhase {
  phase_index: number;
  name: string;
  type: PhaseType;
  intent: string;
  start_date: string;
  end_date: string;
  weeks: MacroWeek[];
}

export interface GateAssumption {
  gated_goal_id: string;
  gating_goal_id: string;
  cleared: boolean;
  rationale: string;
}

export interface MacroPlan {
  plan_name: string;
  start_date: string;
  end_date: string;
  total_weeks: number;
  intent: string;
  phases: MacroPhase[];
  gate: GateAssumption | null;
  flagged_assumptions: string[];
}

// ─── Date helpers (pure, UTC) ─────────────────────────────────────────────────

function parseDate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

/** Monday (dow 0) on or before the given date. */
export function mondayOnOrBefore(iso: string): string {
  const d = parseDate(iso);
  const jsDow = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const offset = (jsDow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return toISO(d);
}

/** Whole weeks between two ISO dates (floor, never negative). */
export function weeksBetween(startISO: string, endISO: string): number {
  const ms = parseDate(endISO).getTime() - parseDate(startISO).getTime();
  return Math.max(0, Math.floor(ms / (7 * MS_PER_DAY)));
}

// ─── Goal helpers ─────────────────────────────────────────────────────────────

export function readGoalTarget(goal: Goal): GoalTarget | null {
  const t = goal.target as Record<string, unknown> | null | undefined;
  if (!t || typeof t !== "object" || t.metric === undefined) return null;
  return t as unknown as GoalTarget;
}

interface Spine {
  primary: Goal; // highest-priority dated goal — sets the timeline
  gating: Goal | null; // process goal that gates the primary, if any
  discipline: SportType; // discipline that drives phase structure
}

/**
 * Pick the plan spine: the highest-priority *dated* goal sets the total
 * timeline; a higher-priority *process* goal that the dated goal is gated_by
 * becomes the gate (design §4.1 step 1).
 */
export function pickSpine(goals: Goal[]): Spine | null {
  const dated = goals
    .filter((g) => g.status === "active" && g.target_date)
    .sort((a, b) => a.priority - b.priority || a.target_date!.localeCompare(b.target_date!));
  if (dated.length === 0) return null;
  const primary = dated[0];

  const target = readGoalTarget(primary);
  const gatedIds = new Set(target?.gated_by ?? []);
  const gating =
    goals.find(
      (g) => g.status === "active" && g.kind === "process" && gatedIds.has(g.id)
    ) ?? null;

  const discipline: SportType = primary.sport ?? "run";
  return { primary, gating, discipline };
}

// ─── Phase allocation ─────────────────────────────────────────────────────────

interface PhaseAlloc {
  type: PhaseType;
  name: string;
  weeks: number;
  intent: string;
}

/**
 * Allocate `totalWeeks` across base → build → peak → taper for an endurance
 * discipline. Taper is fixed (1–2 wk); the remainder splits ~ base 45% /
 * build 35% / peak 20%, clamped so every phase has ≥1 week. Very short plans
 * collapse to a single base block (design §4.1 step 2).
 */
export function allocatePhases(
  totalWeeks: number,
  prefs?: { min_phase_weeks?: number; max_phase_weeks?: number }
): PhaseAlloc[] {
  const n = Math.max(1, Math.floor(totalWeeks));
  const maxPhase = prefs?.max_phase_weeks ?? DEFAULT_MAX_PHASE_WEEKS;

  if (n <= 4) {
    return [{ type: "base", name: "Base", weeks: n, intent: "Aerobic base + consistency" }];
  }

  const taper = n >= 10 ? 2 : 1;
  const remaining = n - taper;

  let base = Math.round(remaining * 0.45);
  let build = Math.round(remaining * 0.35);
  let peak = remaining - base - build;

  // Guarantee each ≥ 1.
  if (peak < 1) {
    peak = 1;
    if (base >= build) base -= 1;
    else build -= 1;
  }
  if (build < 1) {
    build = 1;
    base -= 1;
  }
  base = Math.max(1, base);

  // Reconcile rounding drift back into base.
  base += remaining - (base + build + peak);

  // Clamp each block to the max-phase preference, then redistribute any weeks
  // the clamp shed so the phases still sum exactly to `remaining`. Build and
  // base absorb overflow first (a long aerobic block is the safe place to put
  // extra weeks); if everything is already at max, the leftover lands in base.
  const order: ("base" | "build" | "peak")[] = ["build", "base", "peak"];
  const w: Record<"base" | "build" | "peak", number> = { base, build, peak };
  let overflow = 0;
  for (const k of ["base", "build", "peak"] as const) {
    if (w[k] > maxPhase) {
      overflow += w[k] - maxPhase;
      w[k] = maxPhase;
    }
  }
  while (overflow > 0) {
    const target = order.find((k) => w[k] < maxPhase);
    if (!target) {
      w.base += overflow; // genuinely longer than the preference allows
      break;
    }
    const room = maxPhase - w[target];
    const take = Math.min(room, overflow);
    w[target] += take;
    overflow -= take;
  }

  return [
    { type: "base", name: "Base", weeks: w.base, intent: "Aerobic base + injury-proofing" },
    { type: "build", name: "Build", weeks: w.build, intent: "Progressive volume + specificity" },
    { type: "peak", name: "Peak", weeks: w.peak, intent: "Race-specific sharpening" },
    { type: "taper", name: "Taper", weeks: taper, intent: "Shed fatigue, hold fitness" },
  ];
}

// ─── Base-building gate ───────────────────────────────────────────────────────

function isLowerLimb(part: BodyPart): boolean {
  return LOWER_LIMB_PARTS.includes(part);
}

/**
 * Evaluate the base-building gate (design §6.3). The gate is *closed* (distance
 * progression locked) while any lower-limb flag is still active, or until the
 * gating parts have been clear for RESOLVE_AFTER_CLEAR_CHECKINS consecutive
 * check-ins.
 */
export function evaluateBaseGate(
  gating: Goal,
  gated: Goal,
  activeFlags: InjuryFlag[],
  clearCheckinsByPart: Partial<Record<BodyPart, number>> = {}
): GateAssumption {
  const lowerLimbActive = activeFlags.filter(
    (f) => f.status !== "resolved" && isLowerLimb(f.body_part)
  );

  let cleared: boolean;
  let rationale: string;

  if (lowerLimbActive.length > 0) {
    cleared = false;
    const parts = [...new Set(lowerLimbActive.map((f) => f.body_part))].join(", ");
    rationale = `Base gate closed: ${parts} flag(s) still active. Runs stay at run/walk base until clear for ${RESOLVE_AFTER_CLEAR_CHECKINS} consecutive check-ins.`;
  } else {
    const gatingParts = LOWER_LIMB_PARTS;
    const allClear = gatingParts.every(
      (p) => (clearCheckinsByPart[p] ?? RESOLVE_AFTER_CLEAR_CHECKINS) >= RESOLVE_AFTER_CLEAR_CHECKINS
    );
    cleared = allClear;
    rationale = allClear
      ? `Base gate open: lower-limb flags clear for ≥${RESOLVE_AFTER_CLEAR_CHECKINS} check-ins; distance build unlocked.`
      : `Base gate closed: lower-limb history not yet clear for ${RESOLVE_AFTER_CLEAR_CHECKINS} consecutive check-ins.`;
  }

  return {
    gated_goal_id: gated.id,
    gating_goal_id: gating.id,
    cleared,
    rationale,
  };
}

// ─── Availability → weekly slot scaffold ──────────────────────────────────────

/**
 * Pick `count` days from `candidates` (sorted asc) such that consecutive picks
 * are at least `minRestBetween + 1` apart. Greedy from the front; if the gap
 * can't be satisfied for all, it returns as many spaced days as possible.
 */
export function pickSpacedDays(
  count: number,
  minRestBetween: number,
  candidates: number[]
): number[] {
  if (count <= 0) return [];
  const minGap = minRestBetween + 1;
  const picked: number[] = [];
  for (const day of candidates) {
    if (picked.length === 0 || day - picked[picked.length - 1] >= minGap) {
      picked.push(day);
      if (picked.length === count) break;
    }
  }
  return picked;
}

/**
 * Turn availability into a candidate weekly slot pattern (design §4.1 step 4):
 * runs spaced by their rest rule, climbs (optionally back-to-back), strength
 * stacked onto non-run days. Honors blackout days and days_per_week.
 */
export function mapAvailabilityToSlots(av: Availability): SlotPlan[] {
  const blackout = new Set(av.blackout_dow ?? []);
  const week = [0, 1, 2, 3, 4, 5, 6].filter((d) => !blackout.has(d));

  const run = av.per_sport.run;
  const climb = av.per_sport.climb;
  const strength = av.per_sport.strength;

  const slots: SlotPlan[] = [];
  const usedBySport = new Set<string>();
  const add = (day: number, sport: SportType, hint?: string) => {
    const key = `${day}:${sport}`;
    if (usedBySport.has(key)) return;
    usedBySport.add(key);
    const order = slots.filter((s) => s.day_of_week === day).length;
    slots.push({ day_of_week: day, sport, order_in_day: order, hint });
  };

  // Runs first — they have the strictest spacing.
  const runDays = run
    ? pickSpacedDays(Math.min(run.max_days, week.length), run.min_rest_days_between, week)
    : [];
  runDays.forEach((d) => add(d, "run"));

  // Climbs — prefer days without a run; allow back-to-back if configured.
  if (climb) {
    const climbCandidates = climb.allow_back_to_back
      ? week
      : week.filter((d) => !runDays.includes(d));
    const climbDays = pickSpacedDays(
      Math.min(climb.max_days, climbCandidates.length),
      climb.min_rest_days_between,
      climbCandidates
    );
    climbDays.forEach((d) => add(d, "climb"));
  }

  // Strength — stack onto non-run days first, then anywhere; min_rest 0.
  if (strength) {
    const nonRun = week.filter((d) => !runDays.includes(d));
    const order = nonRun.length ? nonRun : week;
    const strengthDays = pickSpacedDays(
      Math.min(strength.max_days, order.length),
      strength.min_rest_days_between,
      order
    );
    strengthDays.forEach((d) => add(d, "strength"));
  }

  return slots.sort(
    (a, b) => a.day_of_week - b.day_of_week || a.order_in_day - b.order_in_day
  );
}

// ─── Per-week target computation (ramp + deload + caps) ───────────────────────

interface WeekShape {
  phaseType: PhaseType;
}

interface TargetOpts {
  startVolumeM: number;
  /** Hard cap on weekly run volume (gate closed or injury). */
  runWeeklyCapM: number | null;
  runSessions: number;
  climbSessions: number;
  strengthSessions: number;
}

/**
 * Compute per-week targets across the whole plan in one pass. Progression weeks
 * ramp by ≤ RAMP_MAX_PCT off the last progression week; every
 * DELOAD_EVERY_WEEKS-th week is a deload (-DELOAD_REDUCTION); taper weeks scale
 * the peak volume by TAPER_FACTORS. A non-null cap clamps every week.
 */
export function computeWeeklyTargets(weeks: WeekShape[], opts: TargetOpts): WeekTargets[] {
  const out: WeekTargets[] = [];
  let lastProgressionM = opts.startVolumeM;
  let peakM = opts.startVolumeM;
  let progressionCount = 0;
  let taperIdx = 0;

  const cap = (m: number) =>
    opts.runWeeklyCapM != null ? Math.min(m, opts.runWeeklyCapM) : m;

  weeks.forEach((w, i) => {
    const isTaper = w.phaseType === "taper";
    const isDeload = !isTaper && (i + 1) % DELOAD_EVERY_WEEKS === 0;

    let volume: number;
    let intensity: WeekTargets["intensity"];

    if (isTaper) {
      const factor = TAPER_FACTORS[Math.min(taperIdx, TAPER_FACTORS.length - 1)];
      taperIdx += 1;
      volume = Math.round(peakM * factor);
      intensity = "moderate";
    } else if (isDeload) {
      volume = Math.round(lastProgressionM * (1 - DELOAD_REDUCTION));
      intensity = "easy";
    } else {
      if (progressionCount === 0) {
        volume = opts.startVolumeM; // week 1 holds current volume — no jump
      } else {
        // Floor (not round) so the week-over-week ratio can never exceed the cap.
        volume = Math.floor(lastProgressionM * (1 + RAMP_MAX_PCT));
      }
      lastProgressionM = volume;
      progressionCount += 1;
      peakM = Math.max(peakM, volume);
      intensity = w.phaseType === "base" ? "easy" : w.phaseType === "peak" ? "hard" : "moderate";
    }

    volume = cap(volume);
    // If the cap bit, the capped value is the new progression baseline so we
    // never ramp off an un-capped number.
    if (!isTaper && !isDeload) lastProgressionM = volume;
    peakM = Math.max(peakM, isTaper ? peakM : volume);

    out.push({
      weekly_distance_m: volume,
      run_sessions: opts.runSessions,
      climb_sessions: opts.climbSessions,
      strength_sessions: opts.strengthSessions,
      deload: isDeload,
      intensity,
    });
  });

  return out;
}

// ─── Injury caps applied to slots ─────────────────────────────────────────────

/**
 * Apply injury constraints to a week's slots (design §6.1): substitute one run
 * with low-impact cross-training when a lower-limb flag is active, and force a
 * strength/prehab slot tied to each active flag if none is present.
 */
export function applyInjuryCaps(slots: SlotPlan[], activeFlags: InjuryFlag[]): SlotPlan[] {
  const lowerLimb = activeFlags.filter(
    (f) => f.status !== "resolved" && isLowerLimb(f.body_part)
  );
  if (lowerLimb.length === 0) return slots;

  const result = slots.map((s) => ({ ...s }));

  // Swap the last run of the week for low-impact cardio.
  const runIdxs = result
    .map((s, i) => (s.sport === "run" ? i : -1))
    .filter((i) => i >= 0);
  if (runIdxs.length > 0) {
    const swap = runIdxs[runIdxs.length - 1];
    result[swap] = {
      ...result[swap],
      sport: "cross_train",
      hint: "Low-impact cardio (bike/row) — lower-limb flag active",
    };
  }

  // Ensure a prehab strength slot exists.
  const hasStrength = result.some((s) => s.sport === "strength");
  if (!hasStrength) {
    const parts = [...new Set(lowerLimb.map((f) => f.body_part))].join("+");
    const day = result.length ? result[result.length - 1].day_of_week : 3;
    result.push({
      day_of_week: day,
      sport: "strength",
      order_in_day: result.filter((s) => s.day_of_week === day).length,
      hint: `Prehab for ${parts} flag`,
    });
  }

  return result.sort(
    (a, b) => a.day_of_week - b.day_of_week || a.order_in_day - b.order_in_day
  );
}

// ─── Top-level: generate the macro-plan ───────────────────────────────────────

export function generateMacroPlan(input: PeriodizationInput): MacroPlan {
  const spine = pickSpine(input.goals);
  const start = mondayOnOrBefore(input.today);
  const flaggedAssumptions: string[] = [];

  // Fallback: no dated goal → a single 8-week base block off availability.
  if (!spine) {
    return buildPlan({
      name: "Base block",
      intent: "No dated goal — aerobic base + consistency",
      start,
      phases: allocatePhases(8, input.preferences),
      input,
      gate: null,
      gateClosed: input.activeFlags.some((f) => isLowerLimb(f.body_part)),
      flaggedAssumptions,
    });
  }

  const target = readGoalTarget(spine.primary);
  const byDate = target?.by_date ?? spine.primary.target_date!;
  const totalWeeks = Math.max(1, weeksBetween(start, byDate));

  // Gate evaluation.
  let gate: GateAssumption | null = null;
  let gateClosed = input.activeFlags.some(
    (f) => f.status !== "resolved" && isLowerLimb(f.body_part)
  );
  if (spine.gating) {
    gate = evaluateBaseGate(
      spine.gating,
      spine.primary,
      input.activeFlags,
      input.clearCheckinsByPart
    );
    gateClosed = !gate.cleared;
    if (gateClosed) {
      flaggedAssumptions.push(
        `This plan assumes ${spine.primary.title} stays feasible. Distance build is gated by "${spine.gating.title}"; if the gate hasn't cleared by the build phase, the event slides rather than forcing volume.`
      );
    }
  } else if (gateClosed) {
    flaggedAssumptions.push(
      "A lower-limb flag is active, so running is held at run/walk base until it clears."
    );
  }

  const phases = allocatePhases(totalWeeks, input.preferences);

  return buildPlan({
    name: spine.primary.title,
    intent: `Periodized plan for ${spine.primary.title}`,
    start,
    phases,
    input,
    gate,
    gateClosed,
    flaggedAssumptions,
  });
}

interface BuildPlanArgs {
  name: string;
  intent: string;
  start: string;
  phases: PhaseAlloc[];
  input: PeriodizationInput;
  gate: GateAssumption | null;
  gateClosed: boolean;
  flaggedAssumptions: string[];
}

function buildPlan(args: BuildPlanArgs): MacroPlan {
  const { input, phases, start, gateClosed } = args;
  const av = input.availability;

  const runSessions = av.per_sport.run?.max_days ?? 0;
  const climbSessions = av.per_sport.climb?.max_days ?? 0;
  const strengthSessions = av.per_sport.strength?.max_days ?? 0;

  // Flatten to a per-week shape array for one-pass target computation.
  const weekShapes: WeekShape[] = [];
  for (const p of phases) {
    for (let w = 0; w < p.weeks; w++) weekShapes.push({ phaseType: p.type });
  }

  // Caps: gate closed → BASE_GATE cap; otherwise an active lower-limb flag →
  // injury weekly cap; otherwise no cap.
  const lowerLimbActive = input.activeFlags.some(
    (f) => f.status !== "resolved" && isLowerLimb(f.body_part)
  );
  const runWeeklyCapM = gateClosed
    ? BASE_GATE_RUN_CAP_M
    : lowerLimbActive
      ? INJURY_RUN_WEEKLY_CAP_M
      : null;

  const targets = computeWeeklyTargets(weekShapes, {
    startVolumeM: Math.max(1, input.capacity.weekly_distance_m),
    runWeeklyCapM,
    runSessions,
    climbSessions,
    strengthSessions,
  });

  const baseSlots = mapAvailabilityToSlots(av);
  const cappedSlots = lowerLimbActive
    ? applyInjuryCaps(baseSlots, input.activeFlags)
    : baseSlots;

  // Assemble phases with week start dates + per-week targets/slots.
  const macroPhases: MacroPhase[] = [];
  let globalWeek = 0;
  let cursor = start;

  phases.forEach((p, pi) => {
    const phaseStart = cursor;
    const weeks: MacroWeek[] = [];
    for (let w = 0; w < p.weeks; w++) {
      const weekStart = addDays(start, globalWeek * 7);
      const t = targets[globalWeek];
      weeks.push({
        week_index: globalWeek,
        start_date: weekStart,
        theme: t.deload ? `${p.name} — deload` : p.name,
        targets: t,
        slots: cappedSlots.map((s) => ({ ...s })),
      });
      globalWeek += 1;
    }
    const phaseEnd = addDays(start, globalWeek * 7 - 1);
    cursor = addDays(start, globalWeek * 7);
    macroPhases.push({
      phase_index: pi,
      name: p.name,
      type: p.type,
      intent: p.intent,
      start_date: phaseStart,
      end_date: phaseEnd,
      weeks,
    });
  });

  const totalWeeks = globalWeek;
  const endDate = addDays(start, totalWeeks * 7 - 1);

  return {
    plan_name: args.name,
    start_date: start,
    end_date: endDate,
    total_weeks: totalWeeks,
    intent: args.intent,
    phases: macroPhases,
    gate: args.gate,
    flagged_assumptions: args.flaggedAssumptions,
  };
}

// ─── Macro-plan → AdaptationDiff array ─────────────────────────────────────────

/**
 * Placeholder-ref convention for cross-references between freshly-created rows
 * in one batch (the apply engine assigns real ids as it inserts in order). The
 * Stage-3 orchestration substitutes these tokens with the real id of the row
 * created by the referenced diff before/while applying.
 *
 *   "@plan"          → id of the create-plan diff
 *   "@phase:<i>"     → id of the i-th create-phase diff
 *   "@week:<g>"      → id of the global-week-index create-plan_week diff
 */
export const PLAN_REF = "@plan";
export const phaseRef = (i: number) => `@phase:${i}`;
export const weekRef = (g: number) => `@week:${g}`;

/**
 * Emit the macro-plan as an ordered AdaptationDiff array: create plan → create
 * phases → create plan_weeks (with targets) → create prescribed_sessions (the
 * slot scaffold). Cross-references use the placeholder tokens above.
 */
export function generatePlanDiffs(macro: MacroPlan): AdaptationDiff[] {
  const diffs: AdaptationDiff[] = [];

  diffs.push({
    entity_type: "plans",
    entity_id: null,
    op: "create",
    before: null,
    after: {
      name: macro.plan_name,
      status: "draft",
      start_date: macro.start_date,
      end_date: macro.end_date,
      intent: macro.intent,
    },
    fields: ["name", "status", "start_date", "end_date", "intent"],
  });

  macro.phases.forEach((p) => {
    diffs.push({
      entity_type: "phases",
      entity_id: null,
      op: "create",
      before: null,
      after: {
        plan_id: PLAN_REF,
        phase_index: p.phase_index,
        name: p.name,
        type: p.type,
        intent: p.intent,
        start_date: p.start_date,
        end_date: p.end_date,
      },
      fields: ["plan_id", "phase_index", "name", "type", "start_date", "end_date"],
    });

    p.weeks.forEach((wk) => {
      diffs.push({
        entity_type: "plan_weeks",
        entity_id: null,
        op: "create",
        before: null,
        after: {
          phase_id: phaseRef(p.phase_index),
          week_index: wk.week_index,
          start_date: wk.start_date,
          theme: wk.theme ?? null,
          targets: wk.targets,
        },
        fields: ["phase_id", "week_index", "start_date", "theme", "targets"],
      });

      wk.slots
        .filter((s) => s.sport !== "rest")
        .forEach((s) => {
          const scheduled = addDays(wk.start_date, s.day_of_week);
          diffs.push({
            entity_type: "prescribed_sessions",
            entity_id: null,
            op: "create",
            before: null,
            after: {
              plan_week_id: weekRef(wk.week_index),
              day_of_week: s.day_of_week,
              scheduled_date: scheduled,
              sport: s.sport,
              order_in_day: s.order_in_day,
              prescription: { kind: s.sport, hint: s.hint ?? null },
              status: "planned",
            },
            fields: ["plan_week_id", "day_of_week", "scheduled_date", "sport", "prescription"],
          });
        });
    });
  });

  return diffs;
}

// ─── Event feasibility (G5, design §6.3 surfacing) ────────────────────────────

/** Weekly run volume considered "half-marathon ready" going into the taper. */
export const HALF_READY_WEEKLY_M = 32_000;

export type FeasibilityStatus = "on_track" | "at_risk" | "infeasible" | "no_dated_goal";

export interface EventFeasibility {
  status: FeasibilityStatus;
  goal_id: string | null;
  goal_title: string | null;
  target_date: string | null;
  weeks_available: number | null;
  weeks_needed: number | null;
  gate_closed: boolean;
  note: string;
}

/**
 * Pure feasibility check for the primary dated run goal (design §6.3): from the
 * current weekly run volume, ramping ≤ RAMP_MAX_PCT per week, how many weeks
 * until HALF_READY_WEEKLY_M — and do the weeks before the taper allow it?
 * While the gate is closed the ramp can't start, so the projection begins from
 * the gate cap and the note says the clock is effectively paused.
 *
 * Status: on_track (fits) · at_risk (short by ≤ SLIP_WEEKS-equivalent, 4) ·
 * infeasible (short by more). Deliberately conservative and explainable —
 * no LLM, no DB.
 */
export function assessEventFeasibility(args: {
  today: string;
  goal: Pick<Goal, "id" | "title" | "target_date"> | null;
  gateClosed: boolean;
  weeklyDistanceM: number;
}): EventFeasibility {
  const { today, goal, gateClosed, weeklyDistanceM } = args;
  if (!goal?.target_date) {
    return {
      status: "no_dated_goal",
      goal_id: goal?.id ?? null,
      goal_title: goal?.title ?? null,
      target_date: null,
      weeks_available: null,
      weeks_needed: null,
      gate_closed: gateClosed,
      note: "No dated run goal to assess.",
    };
  }

  const msPerWeek = 7 * 86_400_000;
  const totalWeeks = Math.floor(
    (Date.parse(goal.target_date) - Date.parse(today)) / msPerWeek
  );
  const weeksAvailable = Math.max(0, totalWeeks - TAPER_FACTORS.length);

  // Ramp projection: start from today's volume (or the gate cap when closed /
  // volume is effectively zero) and compound RAMP_MAX_PCT weekly.
  let volume = Math.max(gateClosed ? BASE_GATE_RUN_CAP_M : weeklyDistanceM, BASE_GATE_RUN_CAP_M);
  let weeksNeeded = 0;
  while (volume < HALF_READY_WEEKLY_M && weeksNeeded < 200) {
    volume *= 1 + RAMP_MAX_PCT;
    weeksNeeded++;
  }

  const shortfall = weeksNeeded - weeksAvailable;
  const status: FeasibilityStatus =
    shortfall <= 0 ? "on_track" : shortfall <= 4 ? "at_risk" : "infeasible";

  const gateNote = gateClosed
    ? " The base gate is currently CLOSED (lower-limb flag active), so the ramp hasn't started — every closed week consumes the margin."
    : "";
  const note =
    status === "on_track"
      ? `On track: ~${weeksNeeded}w of ≤${Math.round(RAMP_MAX_PCT * 100)}%/wk ramp needed to reach ${Math.round(HALF_READY_WEEKLY_M / 1000)}k/wk; ${weeksAvailable}w available before the taper.${gateNote}`
      : status === "at_risk"
        ? `At risk: needs ~${weeksNeeded}w of ramp but only ${weeksAvailable}w remain before the taper (short ${shortfall}w). A ${SLIP_WEEKS_EQUIV}w slide would restore margin.${gateNote}`
        : `Not feasible on the current date: needs ~${weeksNeeded}w of ramp with only ${weeksAvailable}w available (short ${shortfall}w). Slide the event or reset expectations to finish-only.${gateNote}`;

  return {
    status,
    goal_id: goal.id,
    goal_title: goal.title,
    target_date: goal.target_date,
    weeks_available: weeksAvailable,
    weeks_needed: weeksNeeded,
    gate_closed: gateClosed,
    note,
  };
}

/** Mirror of adaptation.SLIP_WEEKS (kept as a literal to avoid an import cycle). */
const SLIP_WEEKS_EQUIV = 4;
