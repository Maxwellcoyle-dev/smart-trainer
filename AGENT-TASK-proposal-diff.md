# Agent Task (P14) — Richer proposal diff: a real before/after view in the approval queue

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). The pending-proposals queue on the Plan page currently shows each proposal as a **one-line summary** (`op · entity_type · fields`) plus the rationale. When the user approves, the change is applied sight-unseen. This task builds a proper **`ProposalDiff`** component that renders the actual **field-level before → after** of a proposal so the user can see what they're approving — and fixes a real bug: the current summary code assumes a single diff and **breaks for array diffs** (e.g. `fill_week`, which proposes many `prescribed_sessions` at once).

Frontend-only, scoped to `packages/web`. No backend or schema changes.

## Context: what this project is

A personal mobile-first PWA (running + climbing + injury-prevention strength) with Claude in the loop. The coach proposes changes that land in an approval queue; the user approves/rejects; `resolveProposal` applies the diff. The queue is the trust surface for "Claude is writing my plan," so it should show what's actually changing.

## What already exists (read these first)

- **Diff shape** — `packages/core/src/types.ts`:
  ```ts
  AdaptationDiff = {
    entity_type: string;          // e.g. "prescribed_sessions", "goals", "session+run_details"
    entity_id: string | null;     // null for creates
    op: "create" | "update" | "delete" | "replace_subtree";
    before: Record<string, unknown> | null;
    after:  Record<string, unknown> | null;
    fields: string[];             // the fields this diff touches
  }
  Proposal = { id, user_id, source, action_type, diff, rationale, status, created_at, … }
  ```
  **Critical:** a proposal's `diff` is **`AdaptationDiff | AdaptationDiff[]`** — single for `adjust_session`/`log_*`, but an **array** for `fill_week` (one diff per prescribed session). `ProposalSchema.diff` is typed as a single `AdaptationDiffSchema`, but the write layer stores arrays too (see `fillWeek` in `core/writes.ts`), so the component must normalize `Array.isArray(diff) ? diff : [diff]` and never assume one.
- **Current rendering** — `packages/web/src/pages/PlanPage.tsx`, the "Pending proposals" block (~line 362). It casts `p.diff as { entity_type, op, fields }` and joins a one-liner — this silently produces a wrong/empty summary for array diffs. The approve/reject buttons + loading/error states there are fine; keep them.
- **Per-op semantics** (from `core/apply.ts`): `create` → only `after` matters (new row); `update` → `before`→`after` over `fields`; `delete` → `before` is what's removed; `replace_subtree` → whole subtree swap. Mirror these in the display.
- **Styling** — Tailwind, dark theme. Existing tokens in use on this page: `bg-surface`, `bg-surface2`, `text-muted`, `text-danger`, `bg-accent`, `border-border`, rounded-xl/2xl. Match them.

## What to implement

1. **New component** `packages/web/src/components/plan/ProposalDiff.tsx` (create the `components/plan/` dir if needed):
   - Props: `{ diff: AdaptationDiff | AdaptationDiff[] }` (import the type from `@smart-trainer/core`).
   - Normalize to an array. For **multiple** diffs, render a compact list with a header like “N changes” and each entry summarized by `entity_type` + op badge; expand to field rows. For a **single** diff, render it directly.
   - **Per-diff rendering:**
     - An **op badge** (create / update / delete / replace) with a distinct color (e.g. create=accent/green, update=amber, delete=danger), and the `entity_type` (humanized — strip `_`, title-case; `session+run_details` → "Session + Run details").
     - **Field rows** over `diff.fields` (fall back to the union of `before`/`after` keys if `fields` is empty):
       - `update`: `field: before → after` with the old value muted/struck and the new value emphasized.
       - `create`: `field: after` (value added).
       - `delete`: `field: before` (value removed, muted/struck).
     - Render values readably: primitives inline; objects/arrays as compact JSON (truncate long values, e.g. > 120 chars, with a title attr for full text). Handle `null`/missing gracefully ("—").
   - Keep it presentational and defensive — never throw on an unexpected diff shape; if it can't parse a row, show the raw key/value rather than crashing the queue.

2. **Wire it into `PlanPage.tsx`:** replace the inline `summary` one-liner with `<ProposalDiff diff={p.diff} />` inside each proposal card (keep `action_type` as the card title, the rationale line, and the approve/reject controls). Remove the now-dead `summary`/`diff` casting code.

3. **Optional, only if quick:** a collapsed/expandable affordance so a `fill_week` proposal with 6 sessions doesn't dominate the screen (default collapsed to the “N changes” header, tap to expand). If it adds much complexity, skip it and just render the list — note the choice.

## Conventions

- TypeScript strict; web imports use `.ts`/no-extension as the existing files do. Import the `AdaptationDiff` type from `@smart-trainer/core` (don't redefine it).
- No `any` on the public surface — use the real type and narrow internally. The `unknown` values in `before`/`after` should be rendered through a small `formatValue(v: unknown): string` helper.
- Presentational only — no data fetching, no mutations, no new deps.

## Tests / verification

There's no React test runner configured in `web`, so verification is typecheck + a real render:
```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/web typecheck     # exit 0
pnpm --filter @smart-trainer/web build         # exit 0
```
Then exercise it visually if you can run the app: create a proposal both ways — an `adjust_session` (single diff) and a `fill_week` (array diff) — via the coach or MCP, and confirm both render correctly in the queue (the `fill_week` case is the regression that proves the array fix). If you can't run it live, construct a couple of sample `AdaptationDiff` objects (one update, one array-of-creates) in a scratch render or a comment block to reason through the output, and say so in your Result.

## Guardrails

- **Don't touch the backend** (`core`/`server`/`mcp`), the proposal resolution flow, or `hooks.ts` mutation logic. Display layer only.
- **Don't change the approve/reject behavior** — only what's shown above the buttons.
- Don't add a charting/diff library; a few dozen lines of Tailwind + a `formatValue` helper is enough.

## When done — record your result (required)

Append a `## Result (P14 — completed <date>)` section to the bottom of THIS file: branch + commit hash, the component file + how it handles single vs array diffs and each op, whether the expand/collapse was included, how you verified (typecheck/build exit codes + which proposal types you rendered), and anything for the PM. Branch `feat/proposal-diff`, commit message referencing **P14**; open a PR to `main` or note it's ready.

## Result (P14 — completed 2026-06-20)

**Branch:** `feat/proposal-diff` — commit `d69b4f7`

**Component:** `packages/web/src/components/plan/ProposalDiff.tsx`

- Normalizes `diff` to `AdaptationDiff[]` via `Array.isArray` so both single and array diffs work.
- **Single diff:** renders inline without a header.
- **Array diff (e.g. fill_week):** renders a "N changes" toggle button, collapsed by default. Expanding shows each diff in a bordered list — avoids dominating the screen. Expand/collapse IS included.
- **Op rendering:**
  - `create` — emerald badge; shows `field: after` in green.
  - `update` — amber badge; shows `field: struck-before → after`.
  - `delete` — red badge; shows `field: struck-before` in red.
  - `replace_subtree` — purple badge; same before→after display as update.
- Falls back to union of `before`/`after` keys when `fields` is empty. Values truncated at 120 chars with full text in `title`. Never throws — missing values render as "—".
- `entity_type` is humanized (underscores→spaces, title-case; `+` separator preserved).
- Dead `summary`/`diff` casting code removed from `PlanPage.tsx`.

**Verification:**
- `pnpm --filter @smart-trainer/web typecheck` → exit 0
- `pnpm --filter @smart-trainer/web build` → exit 0, 157 modules
- Did not run the live app (no server spun up). Reasoned through output: a single `update` diff with `fields: ["sport", "prescription"]` would render an amber "update" badge, entity type label, and two `field: before → after` rows. An array of `create` diffs from `fill_week` (e.g. 6 sessions) would show "6 changes ▼" collapsed, expanding to 6 individual diff blocks each with an emerald "create" badge and their `after` fields.

**For PM:** The fix for array diffs (the regression in the bug report) is the normalization in `ProposalDiff`. The old cast in PlanPage would produce an empty/wrong summary for any `fill_week` proposal; the new component handles it correctly. PR is ready to merge to `main`.
