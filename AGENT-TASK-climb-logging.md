# Agent Task (P23) — Rich climb logging: capture a full per-climb record

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). Climb logging today captures the bare minimum per climb — grade, discipline, indoor/outdoor, attempts, sends, route name. Max wants every climbing session to record enough detail to **plan future sessions and graph progress over time**: per-climb angle, character, length, effort, send result, and notes, plus the **venue** (which gym / which crag + wall) with autocomplete from history.

This task is the **capture + storage** half. The metrics/graphing half is a separate brief (**P24 — climbing progress views**) that depends on the data model you land here. Build P23 so P24 has clean, queryable columns.

Full-stack: a migration + `core` + `server` + `mcp` + `web` form. Read the whole brief before starting.

## Context: what this project is

A personal mobile-first PWA (running + climbing + injury-prevention strength) with Claude in the loop. Domain writes flow web → `server` (Hono) → `core` → Supabase. Climbs are stored as many rows per session (a session is one outing; a climb is one route/boulder logged within it).

## Decisions already made with Max (build to these — do not re-litigate)

1. **Angle is a single pick; character is multi-select tags.** Each climb has at most one **angle** (slab / vertical / overhang / roof) and zero-or-more **character tags** (powerful, endurance, technical, crimpy, dynamic). Don't collapse them into one field — keeping angle single makes "how do I climb on overhangs vs slab" graphable in P24.
2. **Keep `attempts` + `sends` AND add a `result`.** Do **not** drop the existing attempts/sends counters. Add a per-climb **result** enum (onsight / flash / redpoint / fell-hung / did-not-finish). Both coexist: counters capture "how many goes," result captures the outcome.
3. **Gym / crag / wall are free text with autocomplete from the user's own history.** No fixed/curated lists. Type once ("The Front – South Main", "Maple Canyon – Pipe Dream Wall"); the app remembers and suggests past values. No new reference tables.

## What already exists (read these first)

- **Schema** — `supabase/migrations/20260617170008_sessions.sql`, the `climbs` table:
  ```
  climbs(id, user_id, session_id, grade_id, grade_label, grade_value,
         style climb_style, environment climb_environment,
         attempts, sends, route_name, crag, order_in_session,
         created_at, updated_at, deleted_at)
  ```
  - `style` here is the **discipline** (sport/boulder/top_rope/trad) — NOT the wall angle. Do **not** repurpose it; add new columns for angle/character.
  - `environment` is `indoor|outdoor`. `crag` is free text (currently per-climb). `grade_value` is a denormalized ordinal for pyramid math; `grade_label` is the display string; `grade_id` optionally FKs `grades`.
  - Enums live in `supabase/migrations/20260617170002_enums.sql` (`climb_style`, `climb_environment`, etc.).
  - Session venue: `sessions.location text` already exists and is currently unused by the climb form.
- **Core types** — `packages/core/src/types.ts`: `ClimbSchema`, `ClimbInput`, `LogClimbSessionInput`, `ClimbStyle`, `ClimbEnvironment`. The input types feed the form and the action layer.
- **Write path** — `packages/core/src/actions/writes.ts`, `logClimbSession(...)`: inserts the `sessions` row then bulk-inserts `climbs`, writes one `adaptation_logs` entry (`action_type: "log_climb_session"`), supports `mode: "propose"` (coach) vs `"apply"` (manual). Mirror this exactly for the new fields.
- **Reads** — `packages/core/src/actions/reads.ts` (session/climb reads). Add the autocomplete read here.
- **Server route** — `packages/server/src/routes/logs.ts`: `POST /logs/climb` with a `ClimbBody` zod validator that mirrors `ClimbInput`. Add the new fields to the validator and a new `GET` for autocomplete values.
- **MCP tool** — `packages/mcp/src/index.ts`: the `log_climb_session` tool (so Claude on desktop can log climbs). Extend its input schema to match.
- **Form** — `packages/web/src/components/logging/ClimbLogForm.tsx` + shared inputs in `packages/web/src/components/logging/shared.tsx` (`Field`, `NumField`, `RpeSlider`, `SubmitButton`). The form holds an array of `ClimbEntry` rows and posts via `useLogClimb()` in `packages/web/src/lib/hooks.ts`.
- **Styling** — Tailwind dark theme. Tokens in use: `bg-surface`, `bg-surface2`, `text-muted`, `text-danger`, `bg-accent`, `bg-success`, `border-border`, rounded-xl/2xl. Match the existing climb row.

## What to implement

### 1. Migration — extend `climbs` (new file, valid 14-digit timestamp prefix)
Add new enums and columns. Do **not** edit existing migrations (the ledger is normalized/aligned — P20). New file e.g. `supabase/migrations/<timestamp>_climb_rich.sql`:
- New enums:
  - `climb_angle` → `('slab','vertical','overhang','roof')`
  - `climb_character` → `('powerful','endurance','technical','crimpy','dynamic')` (extensible later)
  - `climb_result` → `('onsight','flash','redpoint','hung','dnf')` (map Max's wording: fell-hung→`hung`, did-not-finish→`dnf`)
- `alter table climbs add column`:
  - `angle climb_angle` (nullable)
  - `character_tags climb_character[] not null default '{}'`
  - `length_ft smallint` (nullable; store feet directly as Max entered — no metric conversion)
  - `effort smallint check (effort between 1 and 10)` (nullable; per-climb effort)
  - `result climb_result` (nullable)
  - `climb_notes text` (nullable; per-climb, distinct from session `notes`)
  - `wall text` (nullable; sector/wall within a gym or crag)
- Keep `attempts`, `sends`, `crag`, `style`, `environment` as-is.
- Add a partial index to support P24 + autocomplete, e.g. `create index idx_climbs_result on climbs(user_id, result) where deleted_at is null;` and consider a GIN index on `character_tags` if you expect to filter by tag.
- **RLS:** new columns inherit the table's existing row policies — confirm no new policy is needed (it isn't; columns ride the table grant). Don't touch `20260617170013_rls.sql`.

### 2. Core — types, write path, autocomplete read
- `types.ts`: add `ClimbAngle`, `ClimbCharacter`, `ClimbResult` zod enums + types. Extend `ClimbSchema` and `ClimbInput` with `angle`, `character_tags`, `length_ft`, `effort`, `result`, `climb_notes`, `wall` (all optional/nullable on input). Add `location` (venue) to `LogClimbSessionInput` if not already wired through.
- `writes.ts` `logClimbSession`: map the new fields into the `climbs` insert rows and into the `sessions.location` (venue). Keep the single `adaptation_logs` entry and the propose/apply branch unchanged in shape.
- `reads.ts`: add `getClimbPlaces(db, userId)` returning distinct, recently-used `{ gyms, crags, walls }` (string lists) from the user's climb sessions/climbs — `gyms` = distinct `sessions.location` where `environment='indoor'`, `crags` = distinct `climbs.crag`, `walls` = distinct `climbs.wall`. Order by recency, cap each list (~25).

### 3. Server — validator + autocomplete endpoint
- `routes/logs.ts`: extend `ClimbBody`'s per-climb object with the new optional fields (`angle`, `character_tags: z.array(ClimbCharacterSchema)`, `length_ft`, `effort`, `result`, `climb_notes`, `wall`) and add top-level `location`.
- Add `GET /logs/climb/places` → `getClimbPlaces`. Auth/middleware identical to the other routes.

### 4. MCP — keep the desktop coach in sync
- `mcp/src/index.ts`: extend the `log_climb_session` tool's input schema with the same new fields so Claude can log a rich climb from desktop. Same validation as the server.

### 5. Web — redesign `ClimbLogForm`
- **Session header (once per session):**
  - Environment toggle (indoor/outdoor) — reuse the existing pill style.
  - **Venue** free-text input, relabeled by environment ("Gym" when indoor, "Crag / Area" when outdoor), backed by a `<datalist>` populated from `GET /logs/climb/places` (add a `useClimbPlaces()` query hook in `hooks.ts`). Writes to session `location`.
  - Optional **Wall / Sector** free-text with its own datalist from `places.walls`.
- **Per-climb row** (extend the existing `ClimbRow`; it's getting big, so make each row **collapsible** — collapsed shows grade + result badge + angle; expand to edit):
  - Grade (existing free-text input — keep), discipline toggle (existing `style`: lead/sport, boulder, top-rope, trad).
  - **Angle**: single-select chip row (slab / vertical / overhang / roof).
  - **Character**: multi-select chips (powerful / endurance / technical / crimpy / dynamic) — toggle on/off, store as array.
  - **Length (ft)**: `NumField`, integer, optional.
  - **Effort**: a compact 1–10 stepper or mini-slider (per climb; distinct from the session RPE).
  - **Result**: single-select (Onsight / Flash / Redpoint / Fell-hung / DNF).
  - **Attempts / Sends**: keep the existing steppers.
  - **Per-climb notes**: small text input.
- Keep the session-level `RpeSlider` + session notes + `SubmitButton` as they are. Posting maps each row to the extended `ClimbInput`; venue → `location`. Don't break the "add climb / remove climb" affordances.
- Defensive defaults: a new climb row defaults `angle: null`, `character_tags: []`, `result: null`, attempts 1 / sends 0 (keep current behaviour). Only `grade_label` is required to save a row (unchanged).

## Conventions

- TypeScript strict; no `any` on public surfaces. Web imports use the existing `.ts`/no-extension style. Import enum types from `@smart-trainer/core` — don't redefine.
- Mirror the existing `logClimbSession` propose/apply + single-audit-entry pattern; don't invent a new write shape.
- Postgres arrays: insert `character_tags` as a JS string array; Supabase handles the `text[]`/enum[] mapping. Validate against the enum in zod before insert.
- Don't add a charting library here (that's P24). No new web deps beyond what's needed for the form.

## Tests / verification

- `core`: extend `packages/core/src/actions/*.test.ts` (vitest) — at minimum a test that `logClimbSession` builds insert rows carrying the new fields, and that `getClimbPlaces` dedupes/limits. Run `pnpm --filter @smart-trainer/core test` if the sandbox allows; if the native vitest/rollup binary can't run (known sandbox limit), say so and rely on typecheck.
- Whole tree: `pnpm -r typecheck` (all 4 packages exit 0) and `pnpm --filter @smart-trainer/web build` (exit 0, PWA precache emitted).
- **DB:** do **not** run `supabase db push`/`db reset` yourself — the migration ledger is Max's to apply. Write the migration, state clearly that it is unapplied and needs `supabase db push` (or Max's normal flow) before the new fields work end-to-end.
- If you can run the app, log one indoor sport session and one outdoor boulder session with angle/character/result/length/notes set, and confirm they persist and the autocomplete suggests the venue on the next session. If you can't run it live, walk through the data path in your Result.

## Guardrails

- **Additive only.** Don't drop or rename existing `climbs` columns (`style`, `attempts`, `sends`, `crag`), don't edit prior migrations, don't touch the proposal/undo flow or RLS.
- Keep the coach (propose) path working — a `fill_week`/coach-logged climb must still validate against the extended schema with the new fields absent.
- Don't gold-plate: no per-climb GPS, no photo upload, no grade-system converter. Just the fields above.
- Mobile-first: the expanded climb row must stay usable one-thumb on a phone. Collapse by default once a row has a grade + result.

## When done — record your result (required)

Append a `## Result (P23 — completed <date>)` section to the bottom of THIS file: branch + commit hash, the migration filename + new enums/columns, the core/server/mcp/web changes, how the venue/wall autocomplete works, how propose/apply and attempts/sends-plus-result coexist, how you verified (typecheck/build/test exit codes + which sessions you logged or why live testing was skipped), the fact that the migration is unapplied and needs Max to push it, and anything for the PM / for P24 (which columns it should graph). Branch `feat/climb-logging`, commit message referencing **P23**; open a PR to `main` or note it's ready.
