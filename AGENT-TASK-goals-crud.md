# Agent Task (P11) — Goals CRUD: create / update / soft-delete training goals

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). Goals already have a live table, a Zod type, and a read action (`getGoals`), and the Plan page already *fetches* goals — but there is **no way to create, edit, or remove one**. This task adds the write half: `createGoal` / `updateGoal` (with soft-delete) in `core`, the server routes, the MCP tools, and a minimal Goals section on the Plan page. It pairs with the just-landed plan authoring (P12) so a user can stand up plan + goals entirely in-app.

This is a **full-stack vertical** (core → server → mcp → web), mirroring how logging and `create_plan` are already wired. Follow the existing patterns exactly rather than inventing new ones.

## Context: what this project is

A personal mobile-first PWA (running + climbing + injury-prevention strength) with Claude in the loop. Data flow: web → `server` (Hono) → `core` (the action layer) → Supabase; the `mcp` package exposes the same `core` actions to Claude Desktop. Every domain write goes through `core` so it can be audited.

## What already exists (read these first)

- **Table** — `supabase/migrations/0004_goals.sql`:
  ```
  goals(id, user_id, kind goal_kind, sport sport_type NULL, title text,
        target_date date NULL, target jsonb DEFAULT '{}', priority smallint DEFAULT 1,
        status goal_status DEFAULT 'active', notes text NULL,
        created_at, updated_at, deleted_at)
  ```
  Enums: `goal_kind = ('event','grade','process','metric')`, `goal_status = ('active','achieved','missed','abandoned')`. There is an `updated_at` trigger and a partial index on `(user_id, status) where deleted_at is null`.
- **Type** — `packages/core/src/types.ts` `GoalSchema` / `Goal` already mirror the table. Add input schemas alongside it; don't redefine the row type.
- **Read action** — `packages/core/src/actions/reads.ts` `getGoals(db, userId, status="active")` filters `deleted_at is null` and orders by `priority`.
- **Write patterns to copy** — `packages/core/src/actions/writes.ts`. Note especially `createPlan` (a direct manual write that appends one `adaptation_logs` row via the local `appendAdaptationLog` helper) and the soft-delete convention used elsewhere (`deleted_at = now()`, never a hard delete for user data).
- **Server pattern** — `packages/server/src/routes/plan.ts` (zod-validated bodies, `c.get("supabase")` / `c.get("userId")`, returns the action result). Goals belong on the **plan router** (`/plan/*`) since `/plan/current` already returns goals.
- **MCP pattern** — `packages/mcp/src/index.ts`, the `create_plan` / `adjust_session` tool registrations (`server.tool(name, description, zodShape, async handler)`, `USER_ID`, `source = "desktop_mcp"`).
- **Web pattern** — `packages/web/src/lib/api.ts` (`api.get/post/put`), `packages/web/src/lib/hooks.ts` (react-query; `useCurrentPlan()` already returns `{ plan, goals }`; mutations invalidate `["plan"]`), and `packages/web/src/pages/PlanPage.tsx` (where plan creation + skeleton already live; goals UI goes here).

## Branch & coordination

- Branch off `main`: `git checkout main && git pull && git checkout -b feat/goals-crud`. (P19 merged the stack to `main`; it is now the trunk.)
- **No new migration is required** — the table already exists. Do **not** add or edit anything under `supabase/migrations/`.
- Touch only: `core/src/types.ts`, `core/src/actions/writes.ts`, `core/src/index.ts` (only if a new export isn't already covered by `export *`), `server/src/routes/plan.ts`, `mcp/src/index.ts`, and the web files (`lib/api.ts` if needed, `lib/hooks.ts`, `pages/PlanPage.tsx`). Add a `core` test file.

## What to implement

1. **`core` — input types** (in `types.ts`, next to `GoalSchema`):
   - `CreateGoalInput`: `kind` (GoalKind), `title` (non-empty), `sport?` (SportType|null), `target_date?` (string|null), `target?` (record, default `{}`), `priority?` (int, default 1), `notes?` (string|null).
   - `UpdateGoalInput`: a partial of the editable fields (`title`, `sport`, `target_date`, `target`, `priority`, `status`, `notes`) — all optional; the caller supplies the goal `id` separately.

2. **`core` — write actions** (in `writes.ts`):
   - `createGoal(db, userId, input, source="manual")` → inserts a `goals` row, appends one `adaptation_logs` entry (`action_type: "create_goal"`, `entity_type: "goals"`, `op: "create"`, `entity_id` = new id), returns the created `Goal`. Model it on `createPlan`.
   - `updateGoal(db, userId, goalId, changes, source="manual")` → fetch current row (scoped to `user_id`), build a `before`/`after` diff over the changed `fields` (like `adjustSession` does), apply the update, append an `adaptation_logs` entry (`action_type: "update_goal"`, `op: "update"`), return the updated `Goal`. Reject an empty change set.
   - **Soft-delete via `updateGoal`**: deleting a goal = setting `status` to `'abandoned'` (a status the enum already has) **and** stamping `deleted_at = now()`. Implement this as a thin `deleteGoal(db, userId, goalId, source)` that calls the same audited update path so the removal is logged too. Never hard-delete.
   - Keep these **direct applies** (manual user actions), consistent with `createPlan` — they do **not** route through the proposal queue.

3. **`server` — routes** (in `routes/plan.ts`, reusing the existing router):
   - `POST /plan/goals` → `createGoal` (201).
   - `PATCH /plan/goals/:id` → `updateGoal`.
   - `DELETE /plan/goals/:id` → `deleteGoal`.
   Validate bodies with `zValidator("json", …)` mirroring the file's existing schemas. (`/plan/current` already returns goals, so no new read route is needed.)

4. **`mcp` — tools** (in `index.ts`, alongside `create_plan`): `create_goal` and `update_goal` (include a `status` field so the coach can mark a goal achieved/abandoned), `source = "desktop_mcp"`. Match the existing `server.tool(...)` shape and JSON-text return.

5. **`web` — minimal Goals UI** (on `PlanPage.tsx`):
   - Add `useCreateGoal` / `useUpdateGoal` / `useDeleteGoal` mutations to `hooks.ts` (POST/PATCH/DELETE via `api`, each invalidating `["plan"]` on success — copy the existing plan mutations). Add `api.patch` and `api.del` helpers to `lib/api.ts` if not present (the wrapper already supports arbitrary methods — just add thin aliases).
   - Render the goals already returned by `useCurrentPlan()` as a small list (title, kind, target_date, priority) with an **add-goal form** (title + kind picker + optional sport/target_date/priority) and per-goal **edit / remove** controls. Keep it consistent with the page's existing Tailwind styling — minimal is fine; this is about closing the loop, not visual polish.

## Conventions

- TypeScript strict, ESM/NodeNext — **server and core imports use the `.js` extension** (`./actions/writes.js`); web (Vite) imports use `.ts`/no-extension as the existing files do. Match each package's existing style exactly.
- No `any`. Reuse `GoalKindSchema` / `GoalStatusSchema` / `SportTypeSchema` from `core` rather than re-enumerating literals.
- Soft-delete only. Audit every write (one `adaptation_logs` row per action).

## Tests (required for this one)

Add `packages/core/src/actions/goals.test.ts` (vitest is already configured in `core` from P16). Cover at minimum, against a mocked or stubbed `db` in the same spirit as `apply.test.ts`/`policy.test.ts`:
- `createGoal` builds the correct insert payload and a `create_goal` audit diff.
- `updateGoal` computes a `before`/`after` diff limited to the changed fields and rejects an empty change set.
- `deleteGoal` sets `status='abandoned'` + `deleted_at` and logs it.
If fully mocking Supabase is heavier than the existing tests warrant, factor the diff-building into a small pure helper (like `shouldRaiseFlag` was extracted in P16) and unit-test that directly; note the choice in your Result.

## Verify (must pass)

```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/core typecheck
pnpm --filter @smart-trainer/core test          # new goals tests green
pnpm --filter @smart-trainer/server typecheck
pnpm --filter @smart-trainer/mcp typecheck
pnpm --filter @smart-trainer/web typecheck
pnpm -r build                                    # if quick
```
If you can run the web app and exercise add/edit/remove against a live server, do so and note it; if the sandbox can't reach Supabase, verify by typecheck + logic read and say so.

## When done — record your result (required)

Append a `## Result (P11 — completed <date>)` section to the bottom of THIS file: branch + commit hash, every file changed and what each does, how soreness-free the audit trail is (which `action_type`s you emit), test results, verify exit codes, and anything for the PM to check (e.g. whether the Goals UI is wired or stubbed). Commit on `feat/goals-crud` with a message referencing **P11**. Open a PR to `main` or note that it's ready to merge.

## Result (P11 — completed 2026-06-20)

**Branch:** `feat/goals-crud`  
**Commit:** `f2d05ba7bf048ac99a117b7a30cdcf9fc2fdc4da`  
**PR:** https://github.com/Maxwellcoyle-dev/smart-trainer/pull/3

### Files changed

| File | What it does |
|------|-------------|
| `packages/core/src/types.ts` | Added `CreateGoalInputSchema` / `CreateGoalInput` and `UpdateGoalInputSchema` / `UpdateGoalInput` next to the existing `GoalSchema`. Both optional-where-expected; defaults live in the action functions. |
| `packages/core/src/actions/writes.ts` | Added `buildGoalDiff` (pure helper), `createGoal`, `updateGoal`, `deleteGoal`. Every function appends one `adaptation_logs` row. |
| `packages/core/src/actions/goals.test.ts` | 4 vitest unit tests for `buildGoalDiff` covering create, update, empty-change, and delete scenarios — no DB mock needed. |
| `packages/server/src/routes/plan.ts` | Added `POST /plan/goals` (201), `PATCH /plan/goals/:id`, `DELETE /plan/goals/:id` on the existing plan router. |
| `packages/mcp/src/index.ts` | Added `create_goal` and `update_goal` MCP tools (source=`desktop_mcp`). `update_goal` exposes the `status` field so Claude can mark goals achieved/abandoned directly. |
| `packages/web/src/lib/api.ts` | Added `api.patch` and `api.del` thin aliases. |
| `packages/web/src/lib/hooks.ts` | Added `Goal` interface, typed `useCurrentPlan` goals field, added `useCreateGoal`, `useUpdateGoal`, `useDeleteGoal` mutations (each invalidates `["plan"]`). |
| `packages/web/src/pages/PlanPage.tsx` | Added Goals section: lists active goals (title, kind, target_date, priority) with inline edit and remove controls; add-goal form with title input, kind picker, and date field. Fully wired — not stubbed. |

### Audit trail (action_types emitted)

- `create_goal` — emitted by `createGoal`; `op: "create"`, before=null, after includes goal_id/kind/title
- `update_goal` — emitted by `updateGoal` (before/after diff limited to changed fields only) **and** by `deleteGoal` (before/after on `status` + `deleted_at`)

### Verify exit codes

```
pnpm --filter @smart-trainer/core typecheck   ✓ (exit 0)
pnpm --filter @smart-trainer/core test        ✓ 14 tests pass (4 new)
pnpm --filter @smart-trainer/server typecheck ✓ (exit 0)
pnpm --filter @smart-trainer/mcp typecheck    ✓ (exit 0)
pnpm --filter @smart-trainer/web typecheck    ✓ (exit 0)
```

### PM notes

- Goals UI is **fully wired** (add, edit title, remove) — not stubbed.
- Live Supabase test not run (sandbox has no DB access); logic review confirms the query patterns match `getGoals` and `adjustSession` exactly.
- `deleteGoal` is a separate helper (not an HTTP hard-delete variant of `updateGoal`) so the server route is explicit; this also keeps MCP simple (no separate delete tool — callers use `update_goal` with `status: "abandoned"` if they want a gentler close, or the web DELETE route for a proper soft-delete).
- No new migration required; table was already in place.
