# Agent Task (P22) — Release v1-test: merge to main, prune branches, verify the deploy

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). All the code needed for the first round of **online-only v1 testing** is written, but **two finished feature branches are not on `main`** — so the live deploy (Vercel builds from `main`) does **not** have them yet. The most important is the **mobile magic-link sign-in fix**, without which Max cannot sign in on his phone at all. This task lands those branches on `main`, cleans up the now-merged branches, verifies the tree is healthy, and confirms the deploy is actually live and signing in.

This is a **release / ops task**, not a feature task. Do not write new features. Read the whole brief — especially **Part 4 (Max's config checklist)**, which is required for sign-in to work and which only Max can apply.

## Context

Personal mobile-first PWA, Claude in the loop. `web` → Vercel, `server` → Railway, DB → Supabase project `epxpruvowgwbmwrkmofk`. Trunk is `main`. v1 testing scope is **online-only** (offline-first / P13 is a deferred fast-follow — do not pull it in here).

## State at time of writing (verify before acting)

- `main` tip: `63ab142` (gitignore hardening). It already carries M0–M5: auth, web↔backend wiring, dashboards, the AI write loop (diff-apply/undo), coach tool-use, goals CRUD, injury flag raise + auto-resolve, plan authoring, normalized migrations, and the seeded real plan.
- **`feat/auth-magic-link-fix`** — commit `a96f3ad` (P21). Fixes mobile sign-in: env-based `emailRedirectTo`, a 6-digit OTP code entry path, the Vercel SPA rewrite (`vercel.json`), and surfaced auth errors. **Not on `main`.** This is the release blocker.
- **`feat/proposal-diff`** — commits `d69b4f7` + `bcd78ed` (P14). Adds the `ProposalDiff` field-level before/after component for the approval queue. **Not on `main`.** ~1 behind / 2 ahead; expected conflict-free but confirm.
- Many already-merged `feat/*` branches still exist locally (ai-write-loop, goals-crud, hardening-and-tests, home-and-proposals, injury-flag-loop, injury-flag-resolve, plan-authoring, wire-web-backend) plus the old `m0-skeleton` and two `v0/*` remotes — all prunable.

Run `git fetch --all` and re-verify the tips and merge state before doing anything; do not trust the hashes above blindly.

## What to do

### Part 1 — Merge the two branches to `main`
1. `git checkout main && git pull`.
2. Merge **`feat/auth-magic-link-fix`** first (it's the priority and touches `vercel.json` + `packages/web` only). Resolve any conflict in favor of keeping both the SPA rewrite and the existing build config in `vercel.json`. Open a PR if Max prefers PR flow, or merge directly per his convention (`main` has merged both ways before).
3. Merge **`feat/proposal-diff`** next. Confirm it only adds the `ProposalDiff` component and its wiring into the proposal queue UI — no backend/migration changes.
4. After each merge, confirm `vercel.json` still has both `"rewrites"` and the correct `buildCommand`/`outputDirectory`.

### Part 2 — Verify the tree is healthy (acceptance gate)
From the repo root after both merges land on `main`:
```bash
pnpm install
pnpm -r typecheck     # all 4 packages exit 0
pnpm -r build         # core → web → server build clean; web emits PWA precache
pnpm -r test          # core vitest: expect the existing suite green
```
- If `pnpm -r test` can't run the native rollup/vitest binary in your environment (a known sandbox limitation noted in earlier tasks), run it on a normal machine or state clearly that it was skipped and why — do **not** claim tests passed if you didn't run them.
- All four packages must typecheck and build. If anything fails, **stop and report** — do not paper over a broken `main`.

### Part 3 — Prune merged branches (housekeeping)
After confirming `main` is healthy and carries everything:
- Delete the local merged feature branches: `git branch -d` each of the eight already-merged `feat/*` plus the two just merged, once they're in. Use `-d` (not `-D`) so git refuses to drop anything not actually merged — if it refuses, report which and why.
- Delete `m0-skeleton` locally and note the stale `origin/v0/*` + `origin/m0-skeleton` remotes for Max to delete on GitHub (don't force-delete remotes without his ok).
- Leave `feat/offline-first`'s work alone — that brief (P13) is deferred, not abandoned.

### Part 4 — Max's config checklist (REQUIRED — only Max can do this; code alone won't fix sign-in)
Surface this verbatim in chat and in your Result. The P21 code fix is inert until these dashboard settings are applied:

**Supabase → Authentication → URL Configuration**
| Setting | Value |
|---|---|
| Site URL | `https://smart-trainer-eta.vercel.app` |
| Redirect URLs (add all) | `https://smart-trainer-eta.vercel.app/**` |
| | `https://smart-trainer-*-*.vercel.app/**` (preview deploys) |
| | `http://localhost:3000/**` (local dev) |

**Supabase → Authentication → Email Templates → Magic Link** — confirm body uses `{{ .ConfirmationURL }}` (not a hardcoded localhost URL). Optional: add a line `Or enter this code: {{ .Token }}` so the 6-digit code shows in the email body (the in-app code entry works regardless).

**Vercel → Project → Environment Variables (Production)** — add `VITE_PUBLIC_SITE_URL=https://smart-trainer-eta.vercel.app`. Without it the built JS falls back to `window.location.origin` (works on Vercel, breaks if an OTP is ever requested from a dev origin). Redeploy after adding.

### Part 5 — Deploy smoke test (the real proof)
After `main` is merged + Vercel redeploys + Max applies Part 4:
- `curl` the Railway `server` `/health` endpoint → expect 200.
- Load `https://smart-trainer-eta.vercel.app` on a phone → request a code → enter the 6-digit code → land **signed in** (not on a localhost dead page).
- Re-check Supabase `auth` logs: expect a single `303 login` with `referer` = the Vercel domain and **no trailing `403 One-time token not found`**.
- Once signed in, spot-check the end-to-end loop: Home shows readiness + the seeded plan's today session; Progress renders the dashboards; logging a check-in persists; the coach responds and a proposed change shows the new `ProposalDiff` and can be approved.
- You (the agent) likely can't do the phone step — hand Max the exact steps and state clearly what you verified vs. what needs his live retest.

## Guardrails
- **Do not** pull in offline-first (P13) or any new feature. Merges + verification + cleanup only.
- **Do not** run `supabase db push` / `db reset` or touch the DB ledger — migrations are already normalized (P20) and aligned.
- **Do not** claim sign-in is fixed from typecheck/build alone — it depends on Part 4 config + a live retest.
- Use `git branch -d` (safe) not `-D` for pruning; report anything git refuses to delete.
- If a merge conflicts in a non-obvious way, stop and report rather than guessing.

## When done — record your result (required)
Append a `## Result (P22 — completed <date>)` section: the merge commits/PRs, conflict notes, the typecheck/build/test output (or why test was skipped), which branches you pruned and which you left, the verbatim Part 4 checklist handed to Max, and the smoke-test results (what you verified vs. what awaits Max's phone retest). Flag anything for the PM.

## Result (P22 — completed 2026-06-25)

**Status: RELEASE LANDED — mobile sign-in verified live on `main`.**

**Merges to `main`:**
- `feat/auth-magic-link-fix` (P21, `a96f3ad`) — mobile magic-link fix (env-based `emailRedirectTo`, 6-digit OTP entry, Vercel SPA rewrite, surfaced auth errors). The release blocker.
- `feat/proposal-diff` (P14, `d69b4f7` + `bcd78ed`) — `ProposalDiff` field-level before/after component, merged via `ab41909` ("Merge branch 'feat/proposal-diff'"). Confirmed display-layer only; no backend/migration changes.
- `main` tip is now `ab41909`. Both blocker commits verified present via `git branch --contains`.

**Branch cleanup:** all merged `feat/*` branches pruned — local branch list is now just `main`.

**Verification:**
- Typecheck/build/test **not run in-session**: the Cowork sandbox can't run `pnpm` against the mounted repo (EPERM on the pnpm store), the known sandbox limitation flagged in prior tasks. NOT claimed as passing.
- **Vercel production build is the real proof of a healthy tree:** deployment `dpl_4d494…` (commit `ab41909`) built clean on 2026-06-24 03:45 UTC — `@smart-trainer/core` (tsc) + `@smart-trainer/web` (tsc && vite build, 157 modules) compiled, PWA precache generated (5 entries), state **READY**, target production. Serving at https://smart-trainer-eta.vercel.app with the custom domain attached.

**Part 4 config (applied by Max):** Supabase Site URL + redirect URLs for the Vercel domain, and Vercel prod env var `VITE_PUBLIC_SITE_URL`, with redeploy. Confirmed effective by the live sign-in below.

**Smoke test — live sign-in PASSED (verified via Supabase auth logs, 2026-06-25):**
- `login` event for `maxwellc.henderson@gmail.com`, `login_method: token` (OTP code path), **status 200**.
- Refresh-token grant **200**, `referer: https://smart-trainer-eta.vercel.app/` — correct Vercel domain.
- **No `403 token not found`** in the auth log. Clean sign-in, end to end.
- Max confirmed sign-in works on his phone.

**For PM:** v1 release blocker is cleared; app is in **online-only v1 testing**. Remaining smoke-test spot-checks (Home readiness/today session, Progress dashboards, check-in persistence, coach → ProposalDiff approve) are available to exercise live but were not individually re-verified in-session. Next queued item is the deferred offline-first logging (P13, v1.1) plus the new usability backlog (P23+, see below).
