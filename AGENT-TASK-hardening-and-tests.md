# Agent Task (P15 + P16) — Auth 401 guard + unit tests for the audit engine

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). Two small, self-contained backend/test-hygiene tasks. Both are low-risk and well-bounded. Do them in one branch.

## Context: what this project is

A personal mobile-first PWA for training (running + climbing + injury-prevention strength) with Claude in the loop. Monorepo packages: `core` (action layer — all DB reads/writes + Zod types), `web`, `server` (Hono API), `mcp`; `web`/`server`/`mcp` depend on `core`. Data flow: web → `server` → `core` → Supabase Postgres. Auth is Supabase magic-link; the web sends the session JWT as a Bearer token, and the server middleware validates it and sets `userId`.

## Branch & coordination

- Branch off the latest tip: `git checkout feat/injury-flag-loop && git checkout -b feat/hardening-and-tests`.
- **Only edit / create:**
  - P15: `packages/server/src/middleware/supabase.ts` (and only if needed, the route files — but prefer to centralize in the middleware).
  - P16: `packages/core/package.json` (add devDeps + a `test` script), a new `packages/core/vitest.config.ts`, a new `packages/core/src/actions/policy.ts`, and new `*.test.ts` files. **Do NOT edit `packages/core/src/actions/writes.ts` or `apply.ts`** — another workstream is in them. Test what's already exported, and put any new pure helper in the new `policy.ts`.
- Do not touch `packages/server/src/routes/plan.ts`, `coach.ts`, the web app, or `mcp` — other workstreams own those.

---

## P15 — Return 401 when there is no authenticated user

**Problem:** `packages/server/src/middleware/supabase.ts` sets `userId` only when a valid Bearer token is present, but never rejects the request when it's missing/invalid. Routes then call `core` with `userId = undefined`, which silently returns nothing or errors oddly. Make unauthenticated requests fail fast with 401.

**Do this:**
- In `getSupabase` middleware, after attempting to resolve the user from the `Authorization` header, if no `userId` was set, return a `401` JSON response (`{ error: "unauthorized" }`) **instead of calling `next()`** — *except* for the health check.
- The health route is `GET /health` and must stay public (it's registered in `app.ts`). Simplest approach: in the middleware, if `c.req.path === "/health"`, skip the auth requirement and call `next()`. (Confirm the exact path by reading `packages/server/src/app.ts`.)
- Keep the existing behavior of attaching the `supabase` client to the context for all requests. Only the *userId requirement* is new.
- Use Hono's idiom: `return c.json({ error: "unauthorized" }, 401);` (don't call `next()` in that branch).

**Verify P15:** `cd packages/server && npx tsc --noEmit` exits 0. Briefly note in your result how `/health` stays reachable.

---

## P16 — Unit tests for the audit engine + injury policy predicate

The audit/undo engine (`invertDiff`) and the injury-flag threshold policy are the highest-logic, highest-risk pieces and currently have **no tests**. Add a test runner and pure unit tests. `applyDiff` needs a live DB so don't test it here — focus on the pure logic.

**1. Add vitest to `core`:**
- In `packages/core/package.json`, add `"vitest": "^2.1.0"` to `devDependencies` and a script `"test": "vitest run"`. (Then run `pnpm install` from the repo root so it's available — if the sandbox can't install, note it and still write the tests + config so they run on a machine that can.)
- Create `packages/core/vitest.config.ts`:
  ```ts
  import { defineConfig } from "vitest/config";
  export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
  ```

**2. Extract the injury policy as a pure, testable predicate** — in a NEW file `packages/core/src/actions/policy.ts` (do not edit `writes.ts`):
  ```ts
  import type { BodyPart } from "../types.js";
  export const SORENESS_FLAG_THRESHOLD = 5;
  /** A soreness reading should raise/update a flag when the part is in scope
   *  (watch-list, or all parts if the list is empty) and severity meets the
   *  threshold. Mirrors the logic inlined in logCheckIn. */
  export function shouldRaiseFlag(
    bodyPart: BodyPart,
    severity: number,
    watchList: BodyPart[],
    threshold: number = SORENESS_FLAG_THRESHOLD
  ): boolean {
    const inScope = watchList.length === 0 || watchList.includes(bodyPart);
    return inScope && severity >= threshold;
  }
  ```
  Export it from `packages/core/src/index.ts` too (add one line to the existing re-exports; that file currently just re-exports the action modules — add `export * from "./actions/policy.js";`). *(This is the one shared file you may touch — keep the edit to a single added export line.)*

**3. Write the tests:**
- `packages/core/src/actions/policy.test.ts` — cover: in-scope + over threshold → true; in-scope + under → false; empty watch-list treats all parts as in scope; out-of-scope part → false; severity exactly at threshold → true (boundary).
- `packages/core/src/actions/apply.test.ts` — import `invertDiff` from `./apply.js` and assert: `create` inverts to `delete` targeting the same `entity_id`; `update` swaps `before`/`after`; a soft-delete-table `delete` inverts to an `update` clearing `deleted_at`; a hard-delete-table (`skeleton_slots`) `delete` inverts to a `create`; an **array** of diffs inverts in **reversed order**. (See `apply.ts` for exact shapes; mirror the envelope type `AdaptationDiff` from `../types.js`.)

**Verify P16:**
```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/core build       # tsc -p, exit 0
cd packages/core && npx tsc --noEmit           # exit 0
npx vitest run                                  # all green (or: pnpm --filter @smart-trainer/core test)
```
Paste the vitest summary (e.g. "2 files, N passed") into your result. If `pnpm install` for vitest is blocked in your sandbox, say so and confirm the test files + config are correct by review.

---

## Conventions

- TypeScript strict, no `any`. ESM imports use `.js` extensions in `core`/`server` source. Reuse `core` types.

## When done — record your result (required)

1. **Append a `## Result (P15 + P16 — completed <date>)` section to the bottom of this file** with: branch name, commit hash(es), what changed for each of P15 and P16, the verification output (tsc exit codes + vitest summary), and anything you want the PM to check.
2. Commit on `feat/hardening-and-tests` with a message referencing **P15** and **P16**.

The PM will read your Result, validate, and update the project brief's Build Log / Open Proposals.

---

## Result (P15 + P16 — completed 2026-06-20)

**Branch:** `feat/hardening-and-tests`

### P15 — Auth 401 guard

**File changed:** `packages/server/src/middleware/supabase.ts`

After attempting to resolve the user from the `Authorization` header, the middleware now checks `c.req.path === "/health"` first — if so, calls `next()` immediately so the health route stays public. For all other paths, if no `userId` was set it returns `c.json({ error: "unauthorized" }, 401)` without calling `next()`.

**Verification:** `cd packages/server && npx tsc --noEmit` → exit 0.

### P16 — Unit tests for audit engine + injury policy predicate

**Files added/changed:**
- `packages/core/package.json` — added `"vitest": "^2.1.0"` to devDependencies and `"test": "vitest run"` script
- `packages/core/vitest.config.ts` — new, includes `src/**/*.test.ts`
- `packages/core/src/actions/policy.ts` — new; exports `SORENESS_FLAG_THRESHOLD` (= 5) and `shouldRaiseFlag`
- `packages/core/src/index.ts` — added `export { shouldRaiseFlag } from "./actions/policy.js"` (named export avoids collision with the same constant already exported from `writes.ts`)
- `packages/core/src/actions/policy.test.ts` — 5 tests covering all required cases
- `packages/core/src/actions/apply.test.ts` — 5 tests covering `invertDiff` for create, update, soft-delete, hard-delete, and array reversal

**Verification:**
```
pnpm --filter @smart-trainer/core build  → exit 0
cd packages/core && npx tsc --noEmit    → exit 0
npx vitest run:

 ✓ src/actions/policy.test.ts (5 tests) 1ms
 ✓ src/actions/apply.test.ts (5 tests) 2ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  285ms
```

**PM note:** `SORENESS_FLAG_THRESHOLD` is already exported from `writes.ts`, so a `export *` in the barrel would conflict. Used a named re-export in `index.ts` to expose only `shouldRaiseFlag` from `policy.ts`; the constant is still importable directly from `@smart-trainer/core/dist/actions/policy.js` or via the named import path.
