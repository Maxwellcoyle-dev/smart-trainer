# Agent Task (P18) — Auto-resolve / downgrade injury flags when soreness subsides

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). P9 built the *open/escalate* half of the injury loop: `logCheckIn` auto-raises and updates `injury_flags` when watch-listed soreness hits the threshold. The other half is missing — once a sore body part **recovers**, its flag stays open forever. This task closes the loop: when a part has been **below threshold for N consecutive check-ins**, automatically **downgrade and eventually resolve** its flag, audited like every other change.

Backend logic task, confined to `packages/core` (plus its tests). Mirrors the existing P9 pass.

## Context: what this project is

A personal mobile-first PWA (running + climbing + injury-prevention strength) with Claude in the loop. Data flow: web → `server` (Hono) → `core` → Supabase. The injury-prevention loop is a headline feature: watch-listed soreness raises an `injury_flag`, which should drive load adjustments — and should also *stand down* when the athlete recovers, so flags stay trustworthy.

## What already exists (read these first)

- **`packages/core/src/actions/writes.ts` → `logCheckIn`** — after upserting the check-in and its `soreness_entries`, it runs an **auto-flag pass**: loads the profile `watch_list` (empty ⇒ all parts in scope), fetches open flags (`status <> 'resolved'`, `deleted_at is null`), and for each soreness entry **at or above** `SORENESS_FLAG_THRESHOLD` (=5) either inserts a new flag (`status: 'watch'`) or updates the matching one (max severity, appended dated narrative). It writes **one** `adaptation_logs` row for the whole check-in (with `raised_flag_ids` in `after`) and returns `raised_flags`. Your resolve pass extends this same function.
- **`packages/core/src/actions/policy.ts`** — `SORENESS_FLAG_THRESHOLD` and the pure `shouldRaiseFlag(bodyPart, severity, watchList, threshold)` predicate (extracted in P16, unit-tested). Add the *recovery* predicate here, the same way.
- **Schema** — `injury_flags(status injury_status, severity, onset_date, resolved_date, narrative, …)`. Enum `injury_status = ('watch','active','rehab','resolved')` (ordered least→most severe; `resolved` is terminal). `soreness_entries(check_in_id, body_part, side, severity)` and `check_ins(user_id, check_in_date, …)` hold the history you'll read recovery from.
- **Matching key** — flags are matched to soreness by `(body_part, side)` in the P9 pass; use the same key.

## The behavior to implement

After the existing raise/escalate pass in `logCheckIn` (apply mode only), add a **recovery pass** over the currently-open flags:

1. **Define recovery in `policy.ts`** as a pure, testable predicate. Add:
   - `SORENESS_RESOLVE_THRESHOLD` (the "recovered" ceiling — soreness **at or below** this counts as recovered; default **2**) and `RESOLVE_AFTER_CLEAR_CHECKINS` (consecutive clear check-ins required to step a flag down; default **3**).
   - `recoveryProgress(recentSeverities: number[], resolveThreshold, requiredClear)` → returns how many of the most-recent consecutive check-ins were `<= resolveThreshold` (capped at `requiredClear`), where a check-in with **no entry** for that part counts as clear (0). Keep it pure — it takes an ordered array (newest first or oldest first; document which) and returns a number. This is the unit-tested core of the feature.

2. **In `logCheckIn`, for each open flag** (the ones you fetched for the raise pass, minus any you just escalated this check-in):
   - Pull that part's soreness severity across the **last `RESOLVE_AFTER_CLEAR_CHECKINS` check-ins** (this one included). Practically: query `soreness_entries` joined to `check_ins` for this `user_id`, `(body_part, side)`, ordered by `check_in_date desc`, limited to that window; treat missing rows as severity 0. (One extra query per check-in is fine — N is tiny. If you'd rather, fetch the window once for all parts.)
   - Compute `recoveryProgress`. If the part has been clear for the full window:
     - **Step the flag down one level** along `watch → resolved` — i.e. `rehab→watch`, `active→watch`… Keep it simple and predictable: if `status` is `active` or `rehab`, set it to `watch`; if it's already `watch`, set it to `resolved` with `resolved_date = <this check-in date>`. Document the transition table you chose in a comment.
     - Append a dated note to `narrative` (e.g. `[date] cleared N check-ins — downgraded watch→resolved`), consistent with the P9 narrative style.
   - Do **not** reopen or touch flags whose part is still sore — those are handled by the raise pass.

3. **Audit + return.** Fold resolved/downgraded flags into the **same single `adaptation_logs`** row the check-in already writes — add a `resolved_flag_ids` (and/or `downgraded_flag_ids`) array to its `after` payload alongside the existing `raised_flag_ids`. Extend the `LogCheckInResult` to also return `resolved_flags` (and/or `downgraded_flags`) so the server/UI can surface "you're cleared." Keep it to one audit entry per check-in, as today.

## Design guardrails

- **Idempotent & monotonic per check-in:** a single `logCheckIn` should never both raise and resolve the *same* `(body_part, side)`. Apply the raise pass first; only run recovery on flags that were **not** escalated by this check-in.
- **`resolved` is terminal** — never auto-resolve a flag a user manually set, and never move a flag *out* of `resolved`. (Re-soreness after resolution opens a *new* flag via the existing raise pass — that's correct.)
- **Apply mode only**, exactly like the raise pass. In `propose` mode `logCheckIn` returns early before any flag work.
- **Don't change the raise-pass behavior** or its thresholds. This is purely additive.
- Keep the recovery thresholds as named exports in `policy.ts` (like `SORENESS_FLAG_THRESHOLD`) so they're easy to tune and test.

## Tests (required)

Extend the `core` vitest suite (`policy.test.ts`, or a new `recovery.test.ts`):
- `recoveryProgress` — fully clear window → returns `requiredClear`; one sore reading inside the window → resets the count; missing entries count as clear; partial windows.
- The transition table (`active→watch`, `watch→resolved` with `resolved_date` set) — test the pure step function if you extract one.
Pure-function coverage is the priority since live-DB tests can't run in the sandbox (no rollup/native binary, no Supabase) — keep the resolve decision logic out of the DB round-trip so it's unit-testable, the way `shouldRaiseFlag` was.

## Verify (must pass)

```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/core typecheck      # exit 0
pnpm --filter @smart-trainer/core test           # P16 tests + your new ones green
pnpm -r typecheck                                 # nothing downstream broke
```
If you can exercise a real recover-over-3-check-ins flow against a live DB, do it and note it; otherwise verify by typecheck + tests + logic read and say so.

## When done — record your result (required)

Append a `## Result (P18 — completed <date>)` section to the bottom of THIS file: branch + commit hash, the recovery thresholds and transition table you chose, exactly how the resolve pass avoids colliding with the raise pass, the new return fields, test results, and verify exit codes. Flag anything for the PM — especially the chosen defaults (`SORENESS_RESOLVE_THRESHOLD`, `RESOLVE_AFTER_CLEAR_CHECKINS`), since Max may want to tune them. Branch `feat/injury-flag-resolve`, commit message referencing **P18**; open a PR to `main` or note it's ready to merge.

## Result (P18 — completed 2026-06-20)

**Branch:** `feat/injury-flag-resolve`  
**Commit:** `3275ad5`  
**PR:** https://github.com/Maxwellcoyle-dev/smart-trainer/pull/4

### Recovery thresholds

| Constant | Default | File |
|---|---|---|
| `SORENESS_RESOLVE_THRESHOLD` | 2 | `packages/core/src/actions/policy.ts` |
| `RESOLVE_AFTER_CLEAR_CHECKINS` | 3 | `packages/core/src/actions/policy.ts` |

**PM flag:** These defaults are a reasonable starting point but Max should tune them based on feel. 2/10 soreness or below as "clear" and 3 consecutive check-ins to step down are conservative-ish. Both are named exports in `policy.ts` — one-line change to adjust.

### Transition table

```
rehab   → watch    (resolved_date not set)
active  → watch    (resolved_date not set)
watch   → resolved (resolved_date = check-in date)
resolved → resolved (terminal, no-op)
```

### How the recovery pass avoids colliding with the raise pass

After the raise pass, a `Set` of `"body_part:side"` keys for all raised/escalated flags is built (`raisedKeys`). The recovery pass filters `openFlags` to exclude any flag whose key is in that set. This guarantees a single `logCheckIn` call never both raises and resolves the same `(body_part, side)`.

### New return fields

`LogCheckInResult` now includes:
- `resolved_flags: InjuryFlag[]` — flags stepped to `resolved` this check-in
- `downgraded_flags: InjuryFlag[]` — flags stepped to `watch` from `active`/`rehab` this check-in

The single `adaptation_logs` row's `after` payload now includes `resolved_flag_ids` and `downgraded_flag_ids` alongside the existing `raised_flag_ids`.

### Test results

```
✓ src/actions/recovery.test.ts (12 tests)
✓ src/actions/policy.test.ts (5 tests)
✓ src/actions/apply.test.ts (5 tests)
✓ src/actions/goals.test.ts (4 tests)
Test Files: 4 passed | Tests: 26 passed
```

### Verify exit codes

```
pnpm --filter @smart-trainer/core typecheck  → exit 0
pnpm --filter @smart-trainer/core test       → exit 0 (26 tests)
pnpm -r typecheck                            → exit 0 (all 4 packages)
```

Live DB not exercised (no Supabase in sandbox). Pure-function coverage is thorough; recovery decision logic is fully outside the DB round-trip and unit-tested.
