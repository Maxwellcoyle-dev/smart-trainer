# Agent Task — Surface readiness, injury flags & the proposals queue in the web app

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). This task wires three read-side surfaces that already exist in the backend `core` package but aren't yet exposed to the web UI. It is deliberately scoped to **read + display + the existing resolve action** — do not build new write/generation logic.

## Context: what this project is

A personal mobile-first PWA for training (running + climbing + injury-prevention strength) with Claude in the loop. Architecture (already built):

- **pnpm monorepo**, packages: `core` (the action layer — all DB reads/writes + types), `web` (Vite + React + Tailwind + TanStack Query PWA), `server` (Hono API that calls `core`), `mcp` (Claude Desktop server). `web`/`server`/`mcp` all depend on `core`.
- **Data flow:** web → `server` (HTTP, action layer) → `core` → Supabase Postgres. The web app never talks to Postgres directly except for auth.
- **Auth:** Supabase magic-link. The web `lib/api.ts` helper attaches the session JWT as a Bearer token automatically; the server middleware (`packages/server/src/middleware/supabase.ts`) validates it and sets `userId`. Use the existing `api` helper — you do not deal with tokens yourself.
- The web app was just wired to the backend in the previous commit (`Wire web app to backend`). Forms, dashboards, and auth already work. Read `packages/web/src/lib/hooks.ts`, `packages/web/src/lib/api.ts`, and `packages/web/src/pages/ProgressPage.tsx` first — they are the patterns to copy.

## Branch & coordination

- Branch off the current branch: `git checkout feat/wire-web-backend && git checkout -b feat/home-and-proposals`.
- **Do NOT touch these files** (another workstream owns them): `packages/core/src/actions/writes.ts`, `packages/core/src/actions/apply.ts` (may not exist yet), `packages/core/src/index.ts`, `packages/server/src/routes/plan.ts`, `packages/server/src/routes/coach.ts`.
- Files you DO own for this task: a new `packages/server/src/routes/wellness.ts`, `packages/server/src/app.ts`, `packages/web/src/lib/hooks.ts`, `packages/web/src/pages/HomePage.tsx`, `packages/web/src/pages/PlanPage.tsx`.

## What already exists in `core` (read these, don't rewrite)

In `packages/core/src/actions/reads.ts` (all exported from `@smart-trainer/core`):

- `getInjuryFlags(db, userId)` → `InjuryFlag[]` — open (non-resolved) flags.
- `getCheckins(db, userId, { from, to })` → `(CheckIn & { soreness_entries: SorenessEntry[] })[]`, ordered by date ascending.
- `getPendingProposals(db, userId)` → `Proposal[]` (status = pending).
- `getAdaptationLog(db, userId, limit?)` → `AdaptationLog[]`.

In `packages/core/src/actions/writes.ts` (already wired to a server route — see `packages/server/src/routes/proposals.ts`):

- `resolveProposal(db, userId, proposalId, "approved" | "rejected")`.

Types `InjuryFlag`, `CheckIn`, `Proposal`, `AdaptationDiff` are exported from `@smart-trainer/core` — import and reuse them, don't redefine.

## Task 1 — Server: a wellness read route

Create `packages/server/src/routes/wellness.ts` following the exact pattern in `packages/server/src/routes/metrics.ts` (a `Hono` router, `c.get("supabase")` and `c.get("userId")`, calling `core` functions):

- `GET /wellness/injury-flags` → returns `getInjuryFlags(db, userId)`.
- `GET /wellness/latest-checkin` → returns the most recent check-in (with soreness). Implement by calling `getCheckins` over the last ~14 days and returning the last element (or `null` if none). Example:
  ```ts
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 14 * 86400_000).toISOString();
  const rows = await getCheckins(db, userId, { from, to });
  return c.json(rows.at(-1) ?? null);
  ```

Register it in `packages/server/src/app.ts` next to the other `app.route(...)` calls:
```ts
import { wellnessRouter } from "./routes/wellness.js";
// ...
app.route("/wellness", wellnessRouter);
```
(Note the `.js` extension in imports — this is an ESM/NodeNext project; match the existing import style exactly.)

## Task 2 — Web hooks

In `packages/web/src/lib/hooks.ts`, add (copy the style of the existing `useWeeklyMileage` / `useAdherence` query hooks and the `useSaveSkeleton` mutation):

- `useInjuryFlags()` — `useQuery` GET `/wellness/injury-flags`, queryKey `["wellness","injury-flags"]`. Type the rows minimally (`id, body_part, side, status, severity, narrative`).
- `useLatestCheckin()` — `useQuery` GET `/wellness/latest-checkin`, queryKey `["home","latest-checkin"]`. Returns an object with `check_in_date, readiness, mood, sleep_hours, soreness_entries[]` or `null`.
- `usePendingProposals()` — `useQuery` GET `/proposals`, queryKey `["proposals"]`.
- `useResolveProposal()` — `useMutation` POST `/proposals/${id}/resolve` with body `{ resolution }`; on success invalidate `["proposals"]`, `["plan"]`, and `["metrics"]`.

The logging mutations already invalidate `["home"]` and `["plan"]`, so the new Home/Plan queries will refresh after a check-in is logged. Keep the `api.get`/`api.post` helper usage identical to existing hooks.

## Task 3 — Home readiness + flags

In `packages/web/src/pages/HomePage.tsx`, replace the static "Readiness" placeholder block with real data from `useLatestCheckin()` and add an active-flags block from `useInjuryFlags()`:

- **Readiness card:** if a check-in exists, show its `readiness` (e.g. big "7/10") plus the check-in date; if none, keep a gentle "Log a check-in to see your readiness" message.
- **Injury flags:** if any open flags, render each as a small pill/row (`body_part` + `status`, color the high-severity ones using the existing `text-warning` / `text-danger` classes). If none, render nothing or a quiet "No active flags."
- Match the existing card styling (`bg-surface rounded-2xl p-4`, `text-muted text-xs uppercase tracking-wider` labels). Don't restructure the "Today's plan" or "Quick log" sections already there.

## Task 4 — Plan: pending proposals queue

In `packages/web/src/pages/PlanPage.tsx`, replace the "Pending proposals" placeholder block with a real list from `usePendingProposals()`:

- For each proposal show: `action_type`, the `rationale` (if present), and an **Approve** / **Reject** pair of buttons that call `useResolveProposal()` with the proposal `id`.
- The proposal's `diff` is a JSON envelope (`{ entity_type, op, fields, before, after }`). For now render a compact summary — e.g. `op` + `entity_type` + the `fields` array joined — not a full diff view. A nicer `ProposalDiff` component is a later task; keep this minimal but functional.
- Show a pending/disabled state on the buttons while the mutation runs, and surface errors with `text-danger` like the skeleton save does. Empty state: "No pending proposals."
- Leave the existing week-skeleton editor in this file untouched.

## Constraints & conventions

- TypeScript strict mode. No `any` — reuse `core` types or write small local interfaces.
- Tailwind theme tokens only (`bg-surface`, `surface2`, `text-muted`, `accent`, `success`, `warning`, `danger`, `border`) — see `packages/web/tailwind.config.js`. No raw hex.
- Mobile-first, large tap targets, one-handed; match the rounded-card aesthetic already in the app.
- Match existing import extensions: web uses `./x.tsx` / `../lib/x.ts`; server uses `./x.js`.

## How to verify (must pass before you're done)

From the repo root:
```bash
pnpm --filter @smart-trainer/core build        # web/server resolve core from its dist
pnpm --filter @smart-trainer/server typecheck   # or: cd packages/server && npx tsc --noEmit
pnpm --filter @smart-trainer/web typecheck      # or: cd packages/web && npx tsc --noEmit
```
All three must exit 0. (A full `vite build` may fail in some sandboxes on a missing native `rollup` binary — that's an environment issue, not your code; `tsc --noEmit` passing is the gate.)

If you can run it end to end: start the server (`pnpm --filter @smart-trainer/server dev` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` set), `pnpm --filter @smart-trainer/web dev`, sign in, log a check-in, and confirm the readiness shows on Home.

## Deliverable

Commit on `feat/home-and-proposals` with a clear message. Summarize what you changed and confirm the three typecheck/build commands pass.

---

## Completed — 2026-06-20

**Commit:** `1ac7869` on branch `feat/home-and-proposals`

### What was done

**Task 1 — `packages/server/src/routes/wellness.ts`** (new file)
- `GET /wellness/injury-flags` → calls `getInjuryFlags(db, userId)`
- `GET /wellness/latest-checkin` → calls `getCheckins` over a 14-day window and returns the last element or `null`
- Registered in `packages/server/src/app.ts` as `app.route("/wellness", wellnessRouter)`

**Task 2 — `packages/web/src/lib/hooks.ts`**
- Added `LatestCheckin` interface
- Added `useInjuryFlags()`, `useLatestCheckin()`, `usePendingProposals()`, `useResolveProposal()` following existing query/mutation patterns
- `useResolveProposal` invalidates `["proposals"]`, `["plan"]`, and `["metrics"]` on success
- Imported `Proposal` type from `@smart-trainer/core`

**Task 3 — `packages/web/src/pages/HomePage.tsx`**
- Readiness card shows real score (`7 / 10` style) with check-in date; falls back to "Log a check-in…" if no data
- Active injury flags rendered as pills with `text-danger` (severity ≥ 4) / `text-warning` (severity ≥ 2) coloring
- Today's plan and Quick log sections left untouched

**Task 4 — `packages/web/src/pages/PlanPage.tsx`**
- Proposals placeholder replaced with live list from `usePendingProposals()`
- Each proposal shows `action_type`, compact diff summary (`op · entity_type · fields`), and `rationale`
- Approve / Reject buttons call `useResolveProposal`; disabled while pending, error shown in `text-danger`
- Week skeleton editor left untouched

### Typecheck / build results
- `pnpm --filter @smart-trainer/core build` — ✅ passes (pre-existing error in unstaged `writes.ts` from another workstream; not introduced here)
- `pnpm --filter @smart-trainer/server typecheck` — ✅ passes
- `pnpm --filter @smart-trainer/web typecheck` — ✅ passes
