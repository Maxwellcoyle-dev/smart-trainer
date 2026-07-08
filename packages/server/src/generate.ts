import Anthropic from "@anthropic-ai/sdk";
import {
  getProfile,
  getGoals,
  getCurrentPlan,
  getInjuryFlags,
  getWeeklyMileage,
  generateMacroPlan,
  generatePlanDiffs,
  validateGeneratedPlan,
  mergePersonalization,
  resolvePlanDiffRefs,
  createProposal,
  type SupabaseClient,
  type Availability,
  type PeriodizationInput,
  type MacroPlan,
  type PlanPersonalization,
  type AdaptationDiff,
  type Proposal,
} from "@smart-trainer/core";

export class GenerateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GenerateError";
  }
}

/** profiles.availability is `{}` until the intake wizard runs. */
function isAvailabilitySet(a: unknown): a is Availability {
  return !!a && typeof a === "object" && typeof (a as Availability).days_per_week === "number";
}

/**
 * Whole-plan generation (design §4.4): Stage-1 engine → Stage-2 personalization
 * → validation seam → one `generate_plan` proposal. Nothing is applied; the
 * athlete approves the proposal in the app, at which point the existing apply
 * engine writes the whole subtree (and a single undo reverts it).
 */
export async function generatePlanProposal(
  db: SupabaseClient,
  userId: string,
  opts: { name?: string } = {}
): Promise<Proposal> {
  const today = new Date().toISOString().slice(0, 10);

  const [profile, goals, flags, mileage, currentPlan] = await Promise.all([
    getProfile(db, userId).catch(() => null),
    getGoals(db, userId),
    getInjuryFlags(db, userId),
    getWeeklyMileage(db, userId, 6),
    getCurrentPlan(db, userId).catch(() => null),
  ]);

  const availability = profile?.availability;
  if (!isAvailabilitySet(availability)) {
    throw new GenerateError(400, "Set your training availability before generating a plan.");
  }
  if (goals.length === 0) {
    throw new GenerateError(400, "Add at least one goal before generating a plan.");
  }

  // Capacity: most recent weekly running volume (metres).
  const weekly_distance_m = mileage.length ? (mileage[mileage.length - 1].distance_m ?? 0) : 0;

  const input: PeriodizationInput = {
    today,
    goals,
    availability,
    capacity: { weekly_distance_m },
    activeFlags: flags,
    preferences: {
      min_phase_weeks: numPref(profile?.preferences, "min_phase_weeks"),
      max_phase_weeks: numPref(profile?.preferences, "max_phase_weeks"),
    },
  };

  // Stage 1 — deterministic structure.
  const macro = generateMacroPlan(input);

  // Validation seam (defence in depth — the engine should already comply).
  const verdict = validateGeneratedPlan(macro, input);
  if (!verdict.ok) {
    throw new GenerateError(
      500,
      `Generated plan failed its own guardrails: ${verdict.violations.join("; ")}`
    );
  }

  let diffs = generatePlanDiffs(macro);

  // Snapshot the availability used into the plan row (design §3): editing
  // availability later won't rewrite this plan.
  diffs = snapshotAvailability(diffs, availability, opts.name);

  // Approving a generated plan should *switch* plans atomically: the previous
  // active plan is completed and the new one lands active, in the same diff
  // array. One approve does the whole transition; one undo restores the old
  // plan and removes the new one (invertDiff reverses array order).
  diffs = withPlanTransition(diffs, currentPlan?.status === "active" ? currentPlan.id : null);

  // Stage 2 — LLM personalization (best-effort; deterministic plan if it fails).
  const personalization = await personalize(macro, input).catch(() => null);
  if (personalization) {
    diffs = mergePersonalization(diffs, personalization, macro);
  }

  // Tokens → concrete UUIDs so the diff array applies through the generic engine.
  const resolved = resolvePlanDiffRefs(diffs);

  const rationale = buildRationale(macro, !!personalization);

  return createProposal(db, userId, "app_coach", "generate_plan", resolved, rationale);
}

function numPref(prefs: unknown, key: string): number | undefined {
  const v = (prefs as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Make the whole-plan proposal an atomic plan *switch*:
 * 1. the new plan is created `active` (the engine emits it `draft` — approval
 *    of the proposal IS the athlete's adoption of the plan), and
 * 2. if another plan is currently active, an update diff completing it is
 *    prepended, so apply order is: complete old → create new.
 */
function withPlanTransition(diffs: AdaptationDiff[], currentPlanId: string | null): AdaptationDiff[] {
  const out: AdaptationDiff[] = diffs.map((d) =>
    d.entity_type === "plans" && d.op === "create"
      ? { ...d, after: { ...(d.after as Record<string, unknown>), status: "active" } }
      : d
  );
  if (currentPlanId) {
    out.unshift({
      entity_type: "plans",
      entity_id: currentPlanId,
      op: "update",
      before: { status: "active" },
      after: { status: "completed" },
      fields: ["status"],
    });
  }
  return out;
}

/** Set plans.availability + (optional) name on the create-plan diff. */
function snapshotAvailability(
  diffs: AdaptationDiff[],
  availability: Availability,
  name?: string
): AdaptationDiff[] {
  return diffs.map((d) => {
    if (d.entity_type !== "plans") return d;
    const after: Record<string, unknown> = { ...(d.after as Record<string, unknown>), availability };
    if (name?.trim()) after.name = name.trim();
    const fields = Array.from(new Set([...(d.fields ?? []), "availability"]));
    return { ...d, after, fields };
  });
}

function buildRationale(macro: MacroPlan, personalized: boolean): string {
  const phases = macro.phases.map((p) => `${p.name} (${p.weeks.length}w)`).join(" → ");
  const lines = [
    `${macro.total_weeks}-week plan for "${macro.plan_name}": ${phases}.`,
  ];
  if (macro.gate) lines.push(macro.gate.rationale);
  for (const a of macro.flagged_assumptions) lines.push(a);
  lines.push(
    personalized
      ? "Sessions personalized by the coach within the engine's caps."
      : "Deterministic plan (personalization unavailable — caps and structure intact)."
  );
  return lines.join(" ");
}

// ─── Stage 2: Opus personalization ─────────────────────────────────────────────

const PERSONALIZE_MODEL = "claude-opus-4-8";

function macroSummary(macro: MacroPlan, input: PeriodizationInput): string {
  const phases = macro.phases.map((p) => {
    const first = p.weeks[0]?.targets;
    const last = p.weeks[p.weeks.length - 1]?.targets;
    return {
      phase_index: p.phase_index,
      name: p.name,
      type: p.type,
      intent: p.intent,
      weeks: p.weeks.length,
      distance_range_m: [first?.weekly_distance_m, last?.weekly_distance_m],
      sessions_per_week: {
        run: first?.run_sessions,
        climb: first?.climb_sessions,
        strength: first?.strength_sessions,
      },
    };
  });
  return JSON.stringify(
    {
      plan: macro.plan_name,
      total_weeks: macro.total_weeks,
      gate: macro.gate?.rationale ?? null,
      flagged_assumptions: macro.flagged_assumptions,
      active_flags: input.activeFlags.map((f) => ({ part: f.body_part, side: f.side, status: f.status })),
      goals: input.goals.map((g) => ({ title: g.title, sport: g.sport, by: g.target_date })),
      phases,
    },
    null,
    2
  );
}

/**
 * Ask Opus to fill week themes + per-sport prescription detail PER PHASE (sessions
 * repeat weekly, so phase-level templates keep this to one cheap call). It may
 * not change any number — only prose. Returns null if the key is absent or the
 * response can't be parsed; the caller then ships the deterministic plan.
 */
async function personalize(
  macro: MacroPlan,
  input: PeriodizationInput
): Promise<PlanPersonalization | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system =
    "You personalize a periodized training plan for a runner+climber. The phase " +
    "structure, week counts, volumes and session counts are FIXED — you may not " +
    "change any number. You only write: a short theme per phase, and a one-line " +
    "prescription per sport per phase (run/climb/strength), respecting active " +
    "injury flags (cap run load, prefer run/walk, make strength prehab for the " +
    "flagged area). Reply with ONLY JSON of shape " +
    '{"phases":[{"phase_index":0,"theme":"...","prescriptions":{"run":"...","climb":"...","strength":"..."}}]}.';

  const res = await client.messages.create({
    model: PERSONALIZE_MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: macroSummary(macro, input) }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parsePersonalization(text, macro);
}

/** Tolerant JSON extraction + shape coercion to valid phase indices only. */
function parsePersonalization(text: string, macro: MacroPlan): PlanPersonalization | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const phasesIn = (raw as { phases?: unknown }).phases;
  if (!Array.isArray(phasesIn)) return null;

  const validIndices = new Set(macro.phases.map((p) => p.phase_index));
  const phases: PlanPersonalization["phases"] = [];
  for (const p of phasesIn) {
    const idx = Number((p as { phase_index?: unknown }).phase_index);
    if (!validIndices.has(idx)) continue;
    const theme = (p as { theme?: unknown }).theme;
    const pres = (p as { prescriptions?: unknown }).prescriptions as Record<string, unknown> | undefined;
    const prescriptions: Record<string, string> = {};
    for (const k of ["run", "climb", "strength", "mobility", "cross_train"]) {
      if (typeof pres?.[k] === "string") prescriptions[k] = pres[k] as string;
    }
    phases.push({
      phase_index: idx,
      theme: typeof theme === "string" ? theme : undefined,
      prescriptions: prescriptions as PlanPersonalization["phases"][number]["prescriptions"],
    });
  }
  return phases.length ? { phases } : null;
}
