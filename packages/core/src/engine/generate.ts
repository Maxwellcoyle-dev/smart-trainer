/**
 * Generation orchestration support (design §4.3–§4.4).
 *
 * Pure helpers that sit between the Stage-1 engine (periodization.ts) and the
 * server route that runs Stage-2 (LLM) personalization and lands the plan as a
 * proposal:
 *
 *   • resolvePlanDiffRefs  — turn the engine's "@plan/@phase/@week" placeholder
 *     tokens into concrete UUIDs so the diff array applies through the generic
 *     apply engine unchanged (parents carry explicit ids; children's FKs point
 *     at them). No change to apply.ts needed.
 *   • mergePersonalization — fold LLM-written week themes + per-sport
 *     prescription detail into the diffs WITHOUT touching structure or targets.
 *   • validateGeneratedPlan — the "constrained generation" seam: re-assert the
 *     Stage-1 guardrails on the final macro-plan; report any violation.
 *
 * NO LLM and NO DB here — same discipline as the engine.
 */

import type { AdaptationDiff, SportType } from "../types.js";
import {
  PLAN_REF,
  phaseRef,
  weekRef,
  RAMP_MAX_PCT,
  DELOAD_EVERY_WEEKS,
  BASE_GATE_RUN_CAP_M,
  INJURY_RUN_WEEKLY_CAP_M,
  LOWER_LIMB_PARTS,
  type MacroPlan,
  type PeriodizationInput,
} from "./periodization.js";

// ─── Ref resolution ───────────────────────────────────────────────────────────

type IdGen = () => string;

const defaultIdGen: IdGen = () =>
  // Node 18+ / browsers: globalThis.crypto.randomUUID
  (globalThis.crypto as Crypto).randomUUID();

/**
 * Replace the engine's placeholder tokens with concrete UUIDs.
 *
 * The engine emits diffs parent-first (plan → phases → weeks → sessions) with
 * FK fields holding tokens ("@plan", "@phase:<i>", "@week:<g>"). We walk in
 * order: substitute any token-valued field using refs resolved so far, mint a
 * UUID for each created row, and register the token that row fulfils. Because
 * parents always precede their children, every token is known by the time it's
 * referenced.
 *
 * The result is a fully self-referential diff array (explicit `entity_id`s,
 * real FK values) that the generic apply engine inserts as-is, and whose
 * inverse cleanly deletes by those ids.
 */
export function resolvePlanDiffRefs(
  diffs: AdaptationDiff[],
  idGen: IdGen = defaultIdGen
): AdaptationDiff[] {
  const refs = new Map<string, string>();
  const out: AdaptationDiff[] = [];

  for (const d of diffs) {
    const after = d.after ? { ...(d.after as Record<string, unknown>) } : null;

    // 1. Substitute known tokens in this diff's fields.
    if (after) {
      for (const [k, v] of Object.entries(after)) {
        if (typeof v === "string" && v.startsWith("@") && refs.has(v)) {
          after[k] = refs.get(v)!;
        }
      }
    }

    // 2. Assign a concrete id for created rows.
    const entityId = d.op === "create" ? d.entity_id ?? idGen() : d.entity_id;

    // 3. Register the token this created row fulfils.
    if (d.op === "create" && entityId && after) {
      let token: string | null = null;
      if (d.entity_type === "plans") token = PLAN_REF;
      else if (d.entity_type === "phases") token = phaseRef(Number(after.phase_index));
      else if (d.entity_type === "plan_weeks") token = weekRef(Number(after.week_index));
      if (token) refs.set(token, entityId);
    }

    out.push({ ...d, entity_id: entityId, after });
  }

  // Defensive: no unresolved tokens should remain in any FK field.
  for (const d of out) {
    if (!d.after) continue;
    for (const v of Object.values(d.after as Record<string, unknown>)) {
      if (typeof v === "string" && v.startsWith("@")) {
        throw new Error(`Unresolved plan diff ref "${v}" in ${d.entity_type}`);
      }
    }
  }

  return out;
}

// ─── Stage-2 personalization merge ────────────────────────────────────────────

/** What the LLM is allowed to return — text only, keyed by phase. */
export interface PlanPersonalization {
  phases: {
    phase_index: number;
    theme?: string;
    /** Per-sport prescription detail applied to that sport's sessions in the phase. */
    prescriptions?: Partial<Record<SportType, string>>;
  }[];
}

/**
 * Fold personalization into the diff array. This ONLY writes:
 *   • plan_weeks.theme  (unless the engine marked the week a deload — keep that)
 *   • prescribed_sessions.prescription.detail  (free text; `kind`/sport untouched)
 *
 * Everything structural — phase/week counts, targets, slots, dates — is left
 * exactly as the engine produced it. Operates on token-form diffs (run before
 * resolvePlanDiffRefs) using the macro to map week → phase.
 */
export function mergePersonalization(
  diffs: AdaptationDiff[],
  personalization: PlanPersonalization,
  macro: MacroPlan
): AdaptationDiff[] {
  const byPhase = new Map(personalization.phases.map((p) => [p.phase_index, p]));

  // week_index → phase_index
  const weekToPhase = new Map<number, number>();
  for (const ph of macro.phases) {
    for (const wk of ph.weeks) weekToPhase.set(wk.week_index, ph.phase_index);
  }

  return diffs.map((d) => {
    const after = d.after ? { ...(d.after as Record<string, unknown>) } : null;
    if (!after) return d;

    if (d.entity_type === "plan_weeks") {
      const phase = byPhase.get(weekToPhase.get(Number(after.week_index)) ?? -1);
      const isDeload =
        typeof after.theme === "string" && after.theme.includes("deload");
      if (phase?.theme && !isDeload) after.theme = phase.theme;
    }

    if (d.entity_type === "prescribed_sessions") {
      const g = weekFromRef(after.plan_week_id);
      const phase = g === null ? undefined : byPhase.get(weekToPhase.get(g) ?? -1);
      const detail = phase?.prescriptions?.[after.sport as SportType];
      if (detail) {
        const presc = { ...(after.prescription as Record<string, unknown>) };
        presc.detail = detail;
        after.prescription = presc;
      }
    }

    return { ...d, after };
  });
}

function weekFromRef(ref: unknown): number | null {
  if (typeof ref !== "string") return null;
  const m = ref.match(/^@week:(\d+)$/);
  return m ? Number(m[1]) : null;
}

// ─── Validation seam (design §4.3) ─────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

/**
 * Re-assert the Stage-1 guardrails on the finished macro-plan — the seam that
 * keeps "constrained generation" literally true. Even though an LLM writes the
 * prose, the numbers it cannot touch are checked here against the same caps the
 * engine claims to honour. Returns every violation found (empty ⇒ ok).
 */
export function validateGeneratedPlan(
  macro: MacroPlan,
  input: PeriodizationInput
): ValidationResult {
  const violations: string[] = [];
  const weeks = macro.phases.flatMap((p) => p.weeks);

  const lowerLimbActive = input.activeFlags.some(
    (f) => f.status !== "resolved" && LOWER_LIMB_PARTS.includes(f.body_part)
  );
  const gateClosed = !!macro.gate && !macro.gate.cleared;
  const runCap = gateClosed
    ? BASE_GATE_RUN_CAP_M
    : lowerLimbActive
      ? INJURY_RUN_WEEKLY_CAP_M
      : null;

  // 1. Ramp: non-deload week-over-week distance increase within RAMP_MAX_PCT.
  for (let i = 1; i < weeks.length; i++) {
    const prev = weeks[i - 1].targets;
    const cur = weeks[i].targets;
    if (cur.deload || prev.deload) continue;
    const prevD = prev.weekly_distance_m ?? 0;
    const curD = cur.weekly_distance_m ?? 0;
    if (prevD > 0 && curD > prevD * (1 + RAMP_MAX_PCT) + 1) {
      violations.push(
        `Week ${i}: distance ${curD}m exceeds ramp cap (${Math.round(prevD * (1 + RAMP_MAX_PCT))}m).`
      );
    }
  }

  // 2. Deload cadence: never more than DELOAD_EVERY_WEEKS progression weeks
  //    without one (only meaningful past that horizon).
  if (weeks.length > DELOAD_EVERY_WEEKS) {
    let sinceDeload = 0;
    for (const w of weeks) {
      sinceDeload = w.targets.deload ? 0 : sinceDeload + 1;
      if (sinceDeload > DELOAD_EVERY_WEEKS) {
        violations.push(
          `${sinceDeload} consecutive build weeks without a deload (max ${DELOAD_EVERY_WEEKS}).`
        );
        break;
      }
    }
  }

  // 3. Run cap honoured while gated / injured.
  if (runCap !== null) {
    for (let i = 0; i < weeks.length; i++) {
      const d = weeks[i].targets.weekly_distance_m ?? 0;
      if (d > runCap + 1) {
        violations.push(`Week ${i}: run volume ${d}m exceeds active cap (${runCap}m).`);
      }
    }
  }

  // 4. Prehab present while a flag is active: each week with an active flag
  //    should carry at least one strength slot.
  if (input.activeFlags.length > 0) {
    const missing = weeks.find(
      (w) => !w.slots.some((s) => s.sport === "strength")
    );
    if (missing) {
      violations.push(
        `Week ${missing.week_index}: no strength/prehab slot while an injury flag is active.`
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
