# Agent Task (P16) — Unit tests for the audit engine + extract a pure injury predicate

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). The two pieces of logic with the most branching and the highest blast radius — the generic **diff-apply/undo engine** (`packages/core/src/actions/apply.ts`) and the **injury auto-flag policy** (inside `logCheckIn` in `packages/core/src/actions/writes.ts`) — currently have **zero tests**. This task adds a real `vitest` setup to `packages/core` and locks both down. As part of it you will extract the injury *decision* into a pure, testable predicate.

This is a backend-only change confined to `packages/core`.

## Context: what this project is

A personal mobile-first PWA for training (running + climbing + injury-prevention strength) with Claude in the loop. Monorepo packages: `core` (action layer — all DB reads/writes + Zod types), `web`, `server`, `mcp`; all depend on `core`. The pieces under test live entirely in `core` and are pure or DB-guarded:

- `invertDiff(diff)` in `apply.ts` — **pure** (no DB): inverts a diff envelope (or array) so re-applying it undoes the original. This is the heart of undo and must be exactly right.
- `applyDiff`/`applyOne` in `apply.ts` — touch Supabase, so only their **pre-DB guard** (`assertAppliable`, which throws `DiffApplyError` for non-whitelisted `entity_type`) is unit-testable without a live DB.
- The injury policy inside `logCheckIn` — for each soreness entry it decides "flag or not" via `inScope && severity >= SORENESS_FLAG_THRESHOLD`, where `inScope = watchList.length === 0 || watchList.includes(body_part)`.

## Branch & coordination

- Branch off the current tip: `git checkout feat/injury-flag-loop && git checkout -b feat/tests-engine-injury`.
- **Only edit / add:**
  - `packages/core/package.json` (add `vitest` devDep + a `test` script).
  - A new `packages/core/src/actions/injury-policy.ts` (the extracted predicate).
  - `packages/core/src/actions/writes.ts` — **only** to import and use the extracted predicate in `logCheckIn` (behavior must be byte-for-byte identical). Do not change any other logic, the function signature, or the return shape.
  - New test files: `packages/core/src/actions/apply.test.ts`, `packages/core/src/actions/injury-policy.test.ts`.
  - Optionally re-export the predicate/threshold from `packages/core/src/index.ts` if needed (don't break existing exports).
- **Do NOT touch:** the server, web, or mcp packages; `reads.ts`; the apply *logic* in `apply.ts` (you import from it, you don't change it); any other `writes.ts` logic.

## What already exists (read first)

- `packages/core/src/actions/apply.ts` — exports `applyDiff`, `invertDiff`, `DiffApplyError`. `invertDiff` rules: `create→delete` (before=after), `update→update` (before/after swapped), `delete→` for **soft-delete tables** an `update` clearing `deleted_at` (after `{deleted_at: null}`), for **hard-delete tables** (`plan_goals`, `skeleton_slots`) a `create` (after=before). An **array** inverts as per-item inverses **in reverse order**. Unknown / `replace_subtree` ops throw `DiffApplyError`. `assertAppliable` throws `DiffApplyError` for any `entity_type` not in the appliable whitelist (e.g. `"sessions"`, `"climbs"`).
- `packages/core/src/actions/writes.ts` — `SORENESS_FLAG_THRESHOLD = 5` (exported), and the `logCheckIn` auto-flag loop (~lines 376–436) with the `inScope` / threshold decision you will extract.
- `packages/core/src/types.ts` — `AdaptationDiff`, `BodyPart`. Reuse them; no `any`.

## What to implement

### 1. Extract the predicate (`injury-policy.ts`)

Create `packages/core/src/actions/injury-policy.ts`:

```ts
import type { BodyPart } from "../types.js";

/** Soreness at or above this severity (0–10) on a watched part raises a flag. */
export const SORENESS_FLAG_THRESHOLD = 5;

/**
 * Pure decision: should a soreness entry raise/update an injury flag?
 * Scope = the profile watch-list; an EMPTY watch-list means *all* parts are in
 * scope (the loop is useful before a watch-list is configured).
 */
export function shouldFlag(
  bodyPart: BodyPart | string,
  severity: number,
  watchList: readonly string[]
): boolean {
  const inScope = watchList.length === 0 || watchList.includes(bodyPart);
  return inScope && severity >= SORENESS_FLAG_THRESHOLD;
}
```

Then in `writes.ts`: import `shouldFlag` (and `SORENESS_FLAG_THRESHOLD` from the new module — keep `writes.ts` re-exporting `SORENESS_FLAG_THRESHOLD` so existing imports of it from `writes.ts` keep working, e.g. `export { SORENESS_FLAG_THRESHOLD } from "./injury-policy.js";`). Replace the inline `const inScope = …; if (!inScope || entry.severity < SORENESS_FLAG_THRESHOLD) continue;` with `if (!shouldFlag(entry.body_part, entry.severity, watchList)) continue;`. **No behavior change.**

### 2. Tests for the audit engine (`apply.test.ts`)

Cover at least:
- `invertDiff` of a `create` → a `delete` with `before` = original `after`, same `entity_type`/`entity_id`.
- `invertDiff` of an `update` → an `update` with `before`/`after` swapped.
- `invertDiff` of a `delete` on a **soft-delete** table (e.g. `prescribed_sessions`) → an `update` setting `deleted_at: null`.
- `invertDiff` of a `delete` on a **hard-delete** table (`plan_goals` or `skeleton_slots`) → a `create` with `after` = original `before`.
- `invertDiff` of an **array** → inverses in **reverse order** (assert order explicitly).
- `invertDiff` round-trip property: for a representative `update` diff, `invertDiff(invertDiff(d))` deep-equals the original `d` (fields preserved).
- Unknown op / `replace_subtree` → throws `DiffApplyError`.
- `applyDiff` with a non-appliable `entity_type` (e.g. `"sessions"`) throws `DiffApplyError` **before** any DB call — pass a stub `db` object whose methods throw if called, to prove the guard fires first.

### 3. Tests for the predicate (`injury-policy.test.ts`)

Cover: empty watch-list → in scope (true at/above threshold); part not in a non-empty watch-list → false even at severity 10; part in watch-list below threshold (severity 4) → false; at threshold (severity 5) → true; above (severity 6) → true.

### 4. Wire vitest

In `packages/core/package.json`: add `"vitest": "^2.0.0"` (or latest 2.x) to `devDependencies` and set `"test": "vitest run"` in `scripts` (replace any placeholder). No config file is required for plain TS unit tests, but add a minimal `vitest.config.ts` only if needed. Run `pnpm install` at the repo root so the workspace picks it up.

## Conventions

- TypeScript strict, ESM/`bundler` resolution (this package uses `"moduleResolution": "bundler"`, so relative test imports use `./apply.js` / `./injury-policy.js` extensions to match the rest of `src`). No `any`; reuse `core` types.
- Tests must be **pure** — no network, no Supabase. The `applyDiff` guard test uses a throwing stub, never a real client.

## Verify (must pass)

```bash
cd ~/dev/smart-trainer
pnpm install                                   # picks up vitest
pnpm --filter @smart-trainer/core test         # all tests green
pnpm --filter @smart-trainer/core typecheck    # tsc --noEmit, exit 0
pnpm --filter @smart-trainer/core build        # exit 0
pnpm --filter @smart-trainer/server typecheck  # exit 0 (writes.ts changed; nothing downstream should break)
pnpm --filter @smart-trainer/web typecheck     # exit 0
```

If `pnpm install` cannot reach the registry in your sandbox, note it in your Result and verify by typecheck + a careful logic read of the tests instead; still write the test files.

## When done — record your result (required)

Append a `## Result (P16 — completed <date>)` section to the bottom of THIS file containing: the branch name and commit hash, what you changed (the extraction + the test files + counts of test cases), how you verified (paste the `pnpm test` summary line and the typecheck exit codes), and anything you left out or want the PM to check. Then commit on `feat/tests-engine-injury` with a message referencing **P16**.
