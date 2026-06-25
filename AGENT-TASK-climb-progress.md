# Agent Task (P24) — Climbing progress views: metrics + graphs over time

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). With rich per-climb data landed in **P23 (climb logging)**, Max wants to **see progress over time** — graphs and metrics that turn the raw climb log into "am I getting stronger, on what, and where." This task builds the read/metrics layer and the Progress-page visualizations on top of the P23 columns.

**Depends on P23.** Do not start until P23's migration + columns (`angle`, `character_tags`, `length_ft`, `effort`, `result`, `climb_notes`, `wall`) are merged to `main` and applied. If P23 isn't in, stop and say so.

Read-only/analytics + UI: a DB view or two + `core` metrics + `server` read + `web` Progress charts. No new writes.

## Context

Personal mobile-first PWA. The Progress page (`packages/web/src/pages/ProgressPage.tsx`) already renders a **grade pyramid** (`PyramidCard`, via `useGradePyramid`) as hand-rolled Tailwind bars — there is **no charting library yet**. Climb analytics today come from the `v_grade_pyramid` view (`supabase/migrations/20260617170012_views.sql`): sends/attempts grouped by environment, discipline, grade_value, month. P23 adds the columns that make richer cuts possible.

## What to build

### 1. Metrics / views (core + DB)
Add over-time series the Progress page can render. Prefer SQL views (consistent with `v_grade_pyramid`, `v_weekly_mileage`, `v_adherence`) plus thin `core/metrics.ts` shapers + `reads.ts` accessors. At minimum:
- **Highest grade sent per month**, split by discipline (rope vs boulder) and environment — the headline "progression" line. Use `grade_value` (denormalized ordinal) for the max; carry `grade_label` for display. Count only rows where the climb was actually sent (`sends > 0` or `result in ('onsight','flash','redpoint')`).
- **Send rate over time** — sends ÷ attempts per month (and/or by `result` mix: onsight/flash/redpoint/hung/dnf as a stacked share).
- **Volume over time** — climbs logged and total attempts per week/month (training load proxy for climbing).
- **Performance by angle and by character tag** — send rate and counts grouped by `angle` (slab/vertical/overhang/roof) and by each `character_tags` value. This is the "what should I train" cut. Unnest `character_tags` for the tag breakdown.
Define a clean return type per series in `types.ts` (mirror the existing `GradePyramidRow`, `WeeklyMileage` interface style).

### 2. Server reads
Add `GET` endpoints under the existing logs/metrics router (follow `routes/metrics.ts`): e.g. `/metrics/climb/progression`, `/metrics/climb/send-rate`, `/metrics/climb/volume`, `/metrics/climb/by-angle`. Same auth/middleware as siblings. Accept a window param (e.g. `?months=12`).

### 3. Web — Progress page charts
- **Charting decision (call it out in your Result):** the app has no chart lib. Either (a) add **Recharts** (`pnpm --filter @smart-trainer/web add recharts`) for real line/bar/stacked charts, or (b) hand-roll lightweight SVG/Tailwind like the existing pyramid. Recommend Recharts for time-series (progression line, volume bars, stacked result mix) since hand-rolling those is a lot of code; keep the existing pyramid as-is. Confirm the chosen lib tree-shakes acceptably (web bundle is already ~527 kB — note the delta).
- Add cards to `ProgressPage.tsx`, mobile-first (full-width, readable one-thumb):
  - **Grade progression** line chart (highest sent grade by month, toggle rope/boulder, indoor/outdoor).
  - **Send rate** trend (line) and/or **result mix** (stacked bar by month).
  - **Climbing volume** (bars: climbs + attempts per week).
  - **By angle / by character** (small bar charts: send rate per angle, per tag) — the planning view.
- Add query hooks in `lib/hooks.ts` mirroring `useGradePyramid`. Keep loading/empty states consistent with existing cards ("No climbs logged yet").

## Conventions

- TypeScript strict, no `any` on public surfaces. Reuse `@smart-trainer/core` types; import grade/enum types, don't redefine.
- Views: new migration file with a valid 14-digit timestamp prefix; don't edit existing migrations. Don't touch RLS (views inherit). Don't run `db push` — leave that to Max; state the view is unapplied.
- Keep everything read-only — no new writes, no mutation hooks.

## Tests / verification

- `core`: unit-test the metric shapers (e.g. highest-grade-per-month picks the max ordinal; send-rate handles zero attempts without NaN; angle breakdown unnests tags correctly). `pnpm --filter @smart-trainer/core test` if the sandbox allows; note if the native binary can't run.
- `pnpm -r typecheck` (4 packages exit 0) + `pnpm --filter @smart-trainer/web build` (exit 0; report bundle-size delta if a chart lib was added).
- If you can run the app with P23 data, screenshot/describe each chart with a couple of logged sessions. If not, reason through each series shape from sample rows in your Result.

## Guardrails

- **Hard dependency on P23** — if its columns aren't on `main`/applied, stop and report; don't stub fake columns.
- Don't regress the existing pyramid card or other Progress cards.
- Don't over-build: no ML, no predictive "projected grade," no goal-setting UI here — just honest views of logged history. Forecasting/goal-linking can be its own later brief.
- Watch the bundle: if adding a chart lib pushes web build past a sensible size, prefer per-chart imports or hand-rolled SVG for the simpler cards.

## When done — record your result (required)

Append a `## Result (P24 — completed <date>)` section: branch + commit, the views/metrics added and their return types, the endpoints, the charting decision (lib vs hand-rolled + bundle delta), the Progress cards added, how you verified (typecheck/build/test + which charts you rendered or why live testing was skipped), the unapplied-view note for Max, and anything for the PM. Branch `feat/climb-progress`, commit message referencing **P24**; open a PR to `main` or note it's ready.
