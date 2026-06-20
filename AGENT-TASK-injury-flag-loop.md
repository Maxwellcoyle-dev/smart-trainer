# Agent Task (P9) — Injury-prevention auto-flag loop in `logCheckIn`

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). This task implements the central injury-prevention loop from the spec (`requirements.md` §6, `data-model.md` §11): when a daily check-in reports soreness on a watch-list body part above a threshold, the system automatically opens or updates an `injury_flag`. Today `logCheckIn` records the check-in but does **not** raise flags and (unlike the other logging actions) does **not** append an adaptation log. Fix both.

This is a backend-only, self-contained change in `packages/core`.

## Context: what this project is

A personal mobile-first PWA for training (running + climbing + injury-prevention strength) with Claude in the loop. Monorepo packages: `core` (action layer — all DB reads/writes + Zod types), `web`, `server`, `mcp`; all depend on `core`. Data flow: web → `server` → `core` → Supabase Postgres. The injury loop lives entirely in `core`; the existing `/logs/checkin` server route and MCP path call into it unchanged.

The loop (spec): `soreness_entry` on a watch-list part above threshold → `core` opens/updates an `injury_flag` → the planner later reads open flags to scale load. `injury_flag.origin` records how it was raised. You are building the first half (check-in → flag).

## Branch & coordination

- Branch off the latest tip: `git checkout feat/home-and-proposals && git pull --ff-only 2>/dev/null; git checkout -b feat/injury-flag-loop`.
  (The write-loop work — `apply.ts`, `fillWeek`, real `resolveProposal` — is already committed on that branch. Don't recreate it.)
- **Only edit:** `packages/core/src/actions/writes.ts` (the `logCheckIn` function) and, if you add a test, a new test file. You MAY add a small exported constant for the threshold.
- **Do NOT touch:** `packages/core/src/actions/apply.ts`, `resolveProposal`/`fillWeek`/`adjustSession`, the server routes, the web app, or the MCP server. Do not change the `logCheckIn` signature or its existing return shape (the server route depends on it) — you may *extend* the return object with an optional field.

## What already exists (read first)

- `packages/core/src/actions/writes.ts` → `logCheckIn(db, userId, input, mode, source)` — inserts `check_ins` (upsert on `user_id,check_in_date`) and replaces `soreness_entries`. This is the function you extend. Note the existing `appendAdaptationLog(db, userId, source, action_type, diff, rationale, extra?)` helper in the same file — reuse it.
- `packages/core/src/actions/reads.ts` → `getProfile(db, userId)` returns the profile including `watch_list: body_part[]`. `getInjuryFlags(db, userId)` returns open flags.
- Types in `packages/core/src/types.ts`: `BodyPart`, `BodySide`, `InjuryStatus`, `WriteSource`, `SorenessInput`, `LogCheckInInput`, `LogCheckInResult`, `AdaptationDiff`. Reuse them.
- `injury_flags` columns (see `data-model.md` §11): `id, user_id, body_part, side, status (watch|active|rehab|resolved), severity (0–10), onset_date, resolved_date, narrative, origin (write_source), deleted_at`.

## The behavior to implement

After the check-in and its soreness entries are written (apply mode only — skip all of this in `propose` mode), run the auto-flag pass:

1. **Determine scope.** Read the profile's `watch_list`. The set of "watched" parts is `watch_list` if it is non-empty; otherwise treat *all* body parts as in scope (so the loop still works before a watch-list is configured).

2. **Threshold.** Export `export const SORENESS_FLAG_THRESHOLD = 5;` and use it. For each soreness entry where `body_part` is in scope **and** `severity >= SORENESS_FLAG_THRESHOLD`:

3. **Open or update a flag.** Look for an existing open flag (`deleted_at is null` and `status <> 'resolved'`) for the same `body_part` **and** `side`:
   - **Exists** → update it: `severity = max(existing.severity, new.severity)`; append a dated line to `narrative` (e.g. `\n[2026-06-20] check-in soreness 6/10`); leave `status` as-is. (The `updated_at` trigger handles timestamps.)
   - **None** → insert a new flag: `{ user_id, body_part, side, status: 'watch', severity, onset_date: <check_in_date>, origin: source, narrative: 'Auto-raised from check-in <date> — <body_part> soreness <severity>/10' }`.

   Match `side` exactly (a soreness entry's `side` defaults to `'na'`). Use the check-in's `check_in_date` for `onset_date`.

4. **Audit.** Append exactly one `adaptation_log` for the check-in via `appendAdaptationLog`, with `action_type: 'log_check_in'`, `source`, and a `create` diff whose `after` includes the check-in id and the ids of any flags raised/updated, e.g. `after: { check_in_id, raised_flag_ids: [...] }`, `fields: ['check_in_date','soreness']`. (The other logging actions already append a log; this brings check-in in line.)

5. **Return.** Extend the returned object with an optional `raised_flags?: <flag rows>[]` (or at least `raised_flag_ids: string[]`) so callers can surface what happened. Keep the existing `mode` / `check_in` fields intact.

### Edge cases
- `propose` mode: behave as today (create a proposal, no domain writes, no flag pass).
- No soreness entries, or none over threshold: still append the check-in adaptation log (with empty `raised_flag_ids`), raise nothing.
- Re-logging the same day (the function already deletes+reinserts soreness): the flag pass will re-evaluate; updating an existing flag to `max` severity is idempotent enough — do not create duplicates (the "exists" check prevents that).
- A part that was sore but is now 0: do **not** auto-resolve flags in this task (resolution is a separate concern). Only open/update.

## Conventions

- TypeScript strict. Reuse `core` types; no `any`. Match the existing supabase-js query style in `writes.ts` (`.from(...).select/insert/update(...).eq(...)`, throw on `error`).
- Keep it readable and commented where the policy (threshold, scope, max-severity) is decided.

## Verify (must pass)

```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/core build      # tsc -p, must exit 0
cd packages/core && npx tsc --noEmit          # exit 0
```
If you add a unit test, prefer a pure test of any extracted helper (e.g. a `shouldFlag(part, severity, watchList)` predicate) so it runs without a DB. A live DB round-trip needs network that may be unavailable in your sandbox — if so, note that you verified via typecheck + logic review.

## When done — record your result (required)

The PM (the orchestrating Claude) curates a backlog and will validate your work. So:

1. **Append a `## Result (P9 — completed <date>)` section to the bottom of this file** (`AGENT-TASK-injury-flag-loop.md`) containing: the branch name, a 3–5 line summary of what you changed, the chosen threshold/scope policy, how you verified (paste the typecheck exit codes), and anything you deliberately left out or want the PM to check.
2. Commit on `feat/injury-flag-loop` with a clear message that references **P9**.

The PM will read that Result section, validate the change, and update the Build Log / Open Proposals in the project brief accordingly.

---

## Result (P9 — completed 2026-06-20)

**Branch:** `feat/injury-flag-loop`  
**Commit:** `9bdbb97`

### What changed

Only `packages/core/src/actions/writes.ts` was edited:

1. **`SORENESS_FLAG_THRESHOLD = 5`** exported as a named constant at the top of the file.
2. **`InjuryFlag` imported** from `../types.js`; **`getProfile` imported** from `./reads.js`.
3. **`LogCheckInResult`** extended with optional `raised_flags?: InjuryFlag[]`.
4. **Auto-flag pass** added after soreness entries are written (apply mode only — propose path is unchanged):
   - Reads `profile.watch_list`; if empty, all body parts are in scope (so the loop works before a watch-list is configured).
   - Fetches all open flags (`deleted_at is null`, `status <> 'resolved'`) in one query.
   - For each soreness entry in scope with `severity >= 5`: finds existing open flag by `body_part + side` → updates `severity = max(existing, new)` and appends `[date] check-in soreness N/10` to `narrative`; if no match → inserts new flag with `status: 'watch'`, `onset_date: check_in_date`, `origin: source`.
   - Appends one `adaptation_log` entry (`action_type: 'log_check_in'`) with `after: { check_in_id, raised_flag_ids }`.
   - Returns `raised_flags` alongside existing `mode` / `check_in` fields.

### Threshold / scope policy

- Threshold: `severity >= 5` (mid-range; conservative enough to avoid noise on mild DOMS).
- Scope: `watch_list` if non-empty; otherwise all parts — so the loop is useful even before the user configures a watch-list.
- Re-logging the same day re-evaluates but cannot create duplicate flags (existence check prevents it).
- Auto-resolve on zero severity: deliberately NOT implemented per spec.

### Verification

```
pnpm --filter @smart-trainer/core build   # exit 0 ✅
cd packages/core && npx tsc --noEmit      # (same tsc, exit 0 ✅)
```

No DB round-trip test added — logic verified via typecheck + review. A pure unit test for the scope/threshold predicate would be a good follow-up (P9-bis).

### Left out / PM check

- No auto-resolve on soreness drop (separate concern, spec deferred).
- `getProfile` returns `null` if profile not found — the code treats `null` as empty watch-list (all parts in scope), which is safe but means flags will fire even for a brand-new user. PM should confirm this is acceptable or add a guard.
