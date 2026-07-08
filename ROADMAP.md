# Smart-Trainer Roadmap: From Climbing/Running App to AI-First Training Coach

_Last updated: 2026-07-08_

## Vision

One place for all fitness: the user states goals in plain language ("send V6 by fall,
lose 10 lb, keep running 3×/week"), the app builds and adapts a plan across a bounded
set of sports (climbing, running, weight training, mobility/cross-train), and data
flows in automatically from wearables (Garmin first) and nutrition tracking. AI is the
coach, not a bolt-on chatbot.

## Where the codebase already helps

The data model is less climbing/running-specific than the UI suggests:

- `sport_type` enum already includes `strength`, `mobility`, `cross_train` — weight
  training is a first-class sport in the DB and the plan skeleton; it's the UI, engine
  heuristics, and Stage-2 prompts that under-serve it.
- `goals` are already general: `kind` (event/grade/process/metric), nullable `sport`,
  free-form `title`, JSONB `target` read via `readGoalTarget()`. A "lose 5 kg" goal fits
  `kind=metric` today with a new `metric` value.
- `session_source` enum already has `import` — the seam for wearable-imported sessions
  exists; nothing is written to it yet.
- `check_ins.bodyweight_kg` is already collected — the raw signal for weight-loss goals.
- The Stage-1 engine (`periodization.ts`) → Stage-2 LLM personalization → proposal/diff
  apply pipeline is sport-agnostic in structure; sports show up as parameters, not
  hard-coded branches, in most of it.

Main gaps: `GoalTargetSchema.metric` enum is narrow (`distance|grade|pace|duration|adherence`);
strength progression logic (load/volume tracking, e1RM) is thin; no ingestion pipeline;
no nutrition/body-composition model; goal entry UI assumes structured forms rather than
natural language.

---

## Phase 1 — General goals (natural-language in, structured out)

**Goal:** the user types any goal; the app turns it into structured `goals` rows and
plans against them, restricted to supported sports.

1. **Widen the goal model (small migration + zod):**
   - Extend `GoalTargetSchema.metric` with `bodyweight`, `strength_load` (e1RM or
     rep-max), `frequency`, `custom`.
   - Add optional `baseline` to `target` JSONB so progress is computable
     (start → target → current).
2. **NL goal intake:** a single free-text box ("What do you want to achieve?") on
   Setup/Goals. LLM parses it into 1-N `CreateGoalInput` drafts (kind, sport, target,
   date) shown as editable cards for confirmation before save. Unsupported sports get
   mapped to `cross_train` with a note, or rejected with an explanation.
3. **Engine awareness:** `periodization.ts` consumes the new metrics —
   `bodyweight` goals bias toward volume/zone-2 and feed nutrition later;
   `strength_load` goals allocate progressive-overload strength sessions.
4. **Strength as first-class:** grow strength session prescriptions (exercise
   selection from a small library, sets×reps×%, progression rules), and add e1RM/volume
   progress views alongside the climb/run ones.

**Deliverable:** "I want to climb V6, deadlift 2× bodyweight, and lose 4 kg by
November" → three structured goals → one coherent multi-sport plan.

## Phase 2 — Garmin integration (activity import first)

**Goal:** runs/hikes/strength recorded on the watch appear as sessions automatically;
daily wellness (sleep, HRV, resting HR, body battery) feeds check-ins/readiness.

**Access path:** the [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/)
(Health API + Activity API) is free but application-gated — Garmin vets each request
for a legitimate use case ([access request form](https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/),
[program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)). It's a
push/webhook model: Garmin POSTs data to your endpoint after user OAuth consent.
Approval for a personal project is plausible but not guaranteed and takes time —
**apply early, build the pipeline in parallel.**

Fallback/bridge options while (or instead of) waiting:
- **Strava API** — self-serve, free; Garmin auto-syncs activities to Strava. Covers
  runs/rides/strength activities (not daily wellness). Fastest path to real data.
- **Aggregators** ([Terra](https://tryterra.co/), [Spike](https://www.spikeapi.com/),
  [Open Wearables](https://openwearables.io/)) — one API for 500+ devices incl. Garmin
  wellness data; usage-priced with free tiers (e.g. Terra's Quick Start credits).
  Good if more devices matter later; adds a paid dependency.
- **Manual FIT/TCX file upload** — zero approval, works today, good MVP for the
  ingestion pipeline.

**Build (source-agnostic on purpose):**
1. `ingest` module in `packages/server`: normalized `ImportedActivity` → dedupe (by
   external id + time window) → map to `sessions` with `source='import'` + a
   `session_imports` table keeping raw payload + provider ids.
2. Webhook endpoints + OAuth connect flow per provider; provider adapters
   (Strava first, Garmin when approved).
3. Wellness ingestion → auto-draft check-ins (sleep, resting HR/HRV → readiness hint)
   that the user confirms rather than types.
4. Reconciliation UI: imported session ↔ prescribed session matching ("was this your
   planned tempo run?") feeding adherence.

**Recommended sequence:** manual FIT upload → Strava adapter → Garmin Health/Activity
API once approved.

## Phase 3 — Nutrition & body composition

**Goal:** weight-loss/gain goals are coached, not just tracked.

1. Model: daily `nutrition_logs` (kcal, protein, optionally macros) + bodyweight trend
   (already in check-ins). Compute rolling TDEE from weight trend + activity load
   rather than formulas alone.
2. Intake options: manual quick-log; photo/text AI estimation ("chicken burrito +
   chips" → kcal range); MyFitnessPal/Cronometer import if API access is workable,
   else CSV; Garmin scale weight via Health API once connected.
3. Coach integration: energy-balance awareness in plan generation (don't schedule
   peak-load weeks in a deep deficit; protein targets on strength days; deload advice
   when weight trend + readiness diverge).

## Phase 4 — AI-first coach surface

**Goal:** the coach feels proactive and unified rather than form-driven.

- Weekly review generated from all streams (training, wellness, nutrition, adherence)
  with a proposal diff the user can accept — the proposal/apply machinery already
  supports this.
- Conversational adjustments ("I tweaked my finger, protect it for 2 weeks") →
  adaptation diffs.
- Push-style nudges (missed check-in, big HRV drop, plan/actual divergence) once
  ingestion makes the data trustworthy.

---

## Suggested order of attack

| # | Item | Effort | Dependency |
|---|------|--------|------------|
| 1 | Apply to Garmin developer program | trivial | none — do now |
| 2 | Goal model widening + NL goal intake | S–M | none |
| 3 | Manual FIT/TCX upload + ingest pipeline | M | none |
| 4 | Strength-first-class engine work | M | 2 |
| 5 | Strava adapter | S | 3 |
| 6 | Garmin adapter + wellness → check-ins | M | 1, 3 |
| 7 | Nutrition model + manual logging | M | 2 |
| 8 | AI nutrition estimation + coach integration | M–L | 7 |
| 9 | Proactive weekly review / nudges | M | 6, 7 |

Sources: [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/) · [Health API](https://developer.garmin.com/gc-developer-program/health-api/) · [Activity API](https://developer.garmin.com/gc-developer-program/activity-api/) · [Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/) · [Access request form](https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/) · [Terra pricing](https://tryterra.co/pricing) · [Open Wearables comparison](https://openwearables.io/compare)
