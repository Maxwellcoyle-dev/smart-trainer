# Agent Task (P20) — Normalize migration filenames to timestamp versions (finish the P10 reconcile)

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). P10 reconciled the Supabase migration *ledger* to match the local filenames (`0001`–`0099`), but `supabase db push --dry-run` still fails:

```
Remote migration versions not found in local migrations directory.
```

**Root cause:** the Supabase CLI only recognizes migration files whose version is a **14-digit timestamp** (`^[0-9]{14}_.*\.sql$`). The local files use short prefixes (`0001_init.sql` … `0099_seed_grades.sql`), so the CLI **ignores them as migrations entirely** — it sees the 14 short versions in the remote ledger (which P10 inserted) but zero matching local files. This task fixes it the maintainable way: **rename the 14 files to valid timestamp versions, preserving their order and domain-split structure, and realign the remote ledger to match** — so `db push` works going forward and new migrations simply append as timestamped files.

Do **not** follow the CLI's auto-suggested `migration repair --status reverted … + db pull` path — that discards the curated per-domain migrations and replaces them with one baseline dump. We are explicitly keeping the granular files.

## Context

A personal mobile-first PWA with Claude in the loop; schema lives on Supabase project `smart-trainer` (ref `epxpruvowgwbmwrkmofk`). The schema is **fully applied and correct** — this task only changes migration **filenames** and the **ledger** (`supabase_migrations.schema_migrations`). It does **not** change any schema SQL, and must never run a real `db push`/`db reset`. The current (post-P10) ledger holds 14 short versions: `0001 0002 0003 0004 0005 0006 0007 0008 0009 0009b 0010 0011 0012 0099`.

## The rename mapping (use exactly this — it preserves order)

14-digit timestamps, strictly increasing in the **same order** as today (note `0009b`'s FK backfill stays between `0009_wellness` and `0010_ai_audit`; the old `0099` seed stays last). All are valid `YYYYMMDDHHMMSS` values (2026-06-17 17:00:01–14):

| Old file | New file | Ledger version | Ledger name |
|---|---|---|---|
| `0001_init.sql` | `20260617170001_init.sql` | `20260617170001` | `init` |
| `0002_enums.sql` | `20260617170002_enums.sql` | `20260617170002` | `enums` |
| `0003_profile.sql` | `20260617170003_profile.sql` | `20260617170003` | `profile` |
| `0004_goals.sql` | `20260617170004_goals.sql` | `20260617170004` | `goals` |
| `0005_plans.sql` | `20260617170005_plans.sql` | `20260617170005` | `plans` |
| `0006_skeleton.sql` | `20260617170006_skeleton.sql` | `20260617170006` | `skeleton` |
| `0007_reference.sql` | `20260617170007_reference.sql` | `20260617170007` | `reference` |
| `0008_sessions.sql` | `20260617170008_sessions.sql` | `20260617170008` | `sessions` |
| `0009_wellness.sql` | `20260617170009_wellness.sql` | `20260617170009` | `wellness` |
| `0009b_fk_backfill.sql` | `20260617170010_fk_backfill.sql` | `20260617170010` | `fk_backfill` |
| `0010_ai_audit.sql` | `20260617170011_ai_audit.sql` | `20260617170011` | `ai_audit` |
| `0011_views.sql` | `20260617170012_views.sql` | `20260617170012` | `views` |
| `0012_rls.sql` | `20260617170013_rls.sql` | `20260617170013` | `rls` |
| `0099_seed_grades.sql` | `20260617170014_seed_grades.sql` | `20260617170014` | `seed_grades` |

Before relying on the mapping, run `ls supabase/migrations/` and confirm these 14 files are exactly what's present. If anything differs, **stop and report** rather than renaming.

## What to do

Branch off `main`: `git checkout main && git pull && git checkout -b feat/migration-rename`.

1. **Rename the files with `git mv`** (preserves history), per the table above. Do **not** open or edit the file contents.
   ```bash
   cd ~/dev/smart-trainer/supabase/migrations
   git mv 0001_init.sql        20260617170001_init.sql
   git mv 0002_enums.sql       20260617170002_enums.sql
   # … all 14 …
   git mv 0099_seed_grades.sql 20260617170014_seed_grades.sql
   ```
   Then `git -C ~/dev/smart-trainer status` should show 14 renames and nothing else.

2. **Realign the remote ledger** so each old short version becomes its new timestamp version + name. Prefer the Supabase MCP (same tool P10 used) running this in one transaction; verify the table/column names first with a `SELECT` (P10 used `supabase_migrations.schema_migrations(version, name, statements)`):
   ```sql
   BEGIN;
   UPDATE supabase_migrations.schema_migrations SET version='20260617170001', name='init'        WHERE version='0001';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170002', name='enums'       WHERE version='0002';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170003', name='profile'     WHERE version='0003';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170004', name='goals'       WHERE version='0004';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170005', name='plans'       WHERE version='0005';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170006', name='skeleton'    WHERE version='0006';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170007', name='reference'   WHERE version='0007';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170008', name='sessions'    WHERE version='0008';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170009', name='wellness'    WHERE version='0009';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170010', name='fk_backfill' WHERE version='0009b';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170011', name='ai_audit'    WHERE version='0010';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170012', name='views'       WHERE version='0011';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170013', name='rls'         WHERE version='0012';
   UPDATE supabase_migrations.schema_migrations SET version='20260617170014', name='seed_grades' WHERE version='0099';
   COMMIT;
   ```
   Confirm exactly 14 rows remain and every `version` is now a 14-digit timestamp (no short versions left):
   ```sql
   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
   ```
   **Equivalent CLI path (if you have Max's credentials instead of MCP):** after the renames, `supabase migration repair --status reverted 0001 0002 0003 0004 0005 0006 0007 0008 0009 0009b 0010 0011 0012 0099` then `supabase migration repair --status applied 20260617170001 … 20260617170014`. Use whichever you can run; the end state is identical.

3. **Grep for stale references** to the old filenames before committing (docs, scripts, comments inside the repo) and update any you find:
   ```bash
   grep -rn "0009b\|0099_seed\|0001_init\|migrations/00" ~/dev/smart-trainer --include='*.md' --include='*.ts' --include='*.json' --include='*.sql' | grep -v node_modules
   ```
   (The schema SQL files themselves don't reference each other by filename, but check.)

4. **Commit** on `feat/migration-rename` (message referencing **P20**), open a PR to `main` or note it's ready.

## Verify (must pass)

- `git status` shows 14 renames, no content diffs in the SQL.
- Ledger query returns 14 rows, all timestamp versions, names per the table.
- **The acceptance gate — `supabase db push --dry-run` reports "no migrations to apply"** (a no-op). This needs Supabase credentials; if you can run it, paste the output. If you can't (no `SUPABASE_ACCESS_TOKEN`/link), do the file renames + ledger realign, then hand Max this exact command to confirm:
  ```bash
  cd ~/dev/smart-trainer
  supabase login          # if needed
  supabase link --project-ref epxpruvowgwbmwrkmofk
  supabase migration list # local + remote should both list the 14 timestamps, aligned
  supabase db push --dry-run   # expect: no migrations to apply
  ```

## Guardrails

- **Never** run `supabase db push` (without `--dry-run`), `supabase db reset`, or any DDL/`DROP` against remote. Only filenames + the ledger table change.
- **Do not edit the contents** of any migration SQL file — renames only.
- **Do not** mark anything reverted-and-pulled into a baseline; we are keeping the 14 granular files.
- Keep order intact: the new versions must sort identically to the old prefixes (the mapping above already guarantees this). If you change the mapping for any reason, preserve strict ordering and re-state it in your Result.
- If the live ledger doesn't contain exactly the 14 short versions P10 left (e.g. a stray `20260618053752` ghost reappeared), **stop and report** — don't guess.

## Going forward (note for the Result / PM)

After this, the standard workflow is restored: create new migrations with `supabase migration new <name>` (auto-timestamped), and `supabase db push` will apply only the new ones. The short-numeric convention is retired.

## When done — record your result (required)

Append a `## Result (P20 — completed <date>)` section to the bottom of THIS file: branch + commit hash + PR, confirmation of the 14 renames, the before/after ledger query output, which path you used (MCP SQL vs CLI repair), the `db push --dry-run` result (or the command handed to Max), any stale references you updated, and anything for the PM to verify.

## Result (P20 — completed 2026-06-20)

**Branch:** `feat/migration-rename` | **Commit:** `2fe8e48` | **PR:** https://github.com/Maxwellcoyle-dev/smart-trainer/pull/5

### 14 renames (git mv, no content changes)
| Old | New |
|---|---|
| `0001_init.sql` | `20260617170001_init.sql` |
| `0002_enums.sql` | `20260617170002_enums.sql` |
| `0003_profile.sql` | `20260617170003_profile.sql` |
| `0004_goals.sql` | `20260617170004_goals.sql` |
| `0005_plans.sql` | `20260617170005_plans.sql` |
| `0006_skeleton.sql` | `20260617170006_skeleton.sql` |
| `0007_reference.sql` | `20260617170007_reference.sql` |
| `0008_sessions.sql` | `20260617170008_sessions.sql` |
| `0009_wellness.sql` | `20260617170009_wellness.sql` |
| `0009b_fk_backfill.sql` | `20260617170010_fk_backfill.sql` |
| `0010_ai_audit.sql` | `20260617170011_ai_audit.sql` |
| `0011_views.sql` | `20260617170012_views.sql` |
| `0012_rls.sql` | `20260617170013_rls.sql` |
| `0099_seed_grades.sql` | `20260617170014_seed_grades.sql` |

### Ledger — before
```
0001 0002 0003 0004 0005 0006 0007 0008 0009 0009b 0010 0011 0012 0099
```

### Ledger — after (via Supabase MCP `execute_sql`, single transaction)
```
20260617170001 init
20260617170002 enums
20260617170003 profile
20260617170004 goals
20260617170005 plans
20260617170006 skeleton
20260617170007 reference
20260617170008 sessions
20260617170009 wellness
20260617170010 fk_backfill
20260617170011 ai_audit
20260617170012 views
20260617170013 rls
20260617170014 seed_grades
```
14 rows, all 14-digit timestamps, no short versions remaining.

### Stale references updated
- `AGENT-TASK-goals-crud.md` line 13: `0004_goals.sql` → `20260617170004_goals.sql`
- SQL file comments referencing `0009b` inside `20260617170005_plans.sql` were left as-is (guardrail: no SQL content edits).

### Acceptance gate — hand to Max
```bash
cd ~/dev/smart-trainer
supabase link --project-ref epxpruvowgwbmwrkmofk
supabase migration list     # both local + remote should list 14 timestamps, aligned
supabase db push --dry-run  # expect: no migrations to apply
```
