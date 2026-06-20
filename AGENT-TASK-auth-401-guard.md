# Agent Task (P15) — Return 401 when no authenticated user, instead of running with `undefined`

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). Today every server route runs even when there is no authenticated user: the Supabase middleware sets `c.get("userId")` **only** when a valid Bearer token is present, and otherwise leaves it unset — so `core` actions execute with `userId === undefined`, silently returning nothing or mis-attributing writes. This task adds a guard that rejects unauthenticated requests with a clean **401** before any route handler runs, while keeping `/health` public.

Backend-only, confined to `packages/server`.

## Context: what this project is

A personal mobile-first PWA (running + climbing + injury-prevention strength) with Claude in the loop. Data flow: web → `server` (Hono) → `core` → Supabase. The server uses a single global middleware `getSupabase` (in `packages/server/src/middleware/supabase.ts`) that creates the Supabase client and, if the `Authorization: Bearer <jwt>` header validates, sets `userId`. Routes then read `c.get("userId")`.

## Branch & coordination

- Branch off the current tip: `git checkout feat/injury-flag-loop && git checkout -b feat/auth-401-guard`.
- **Only edit:** `packages/server/src/middleware/supabase.ts` (add a `requireUser` middleware) and `packages/server/src/app.ts` (apply it to protected routes; keep `/health` public). You MAY add one test file under `packages/server`.
- **Do NOT touch:** `core`, `web`, `mcp`, or any route handler files. Do not change the `getSupabase` behavior of *setting* `userId` — only add the guard.

## What already exists (read first)

`packages/server/src/middleware/supabase.ts` — `getSupabase` middleware: reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, sets `c.set("supabase", …)`, and sets `c.set("userId", user.id)` only when a Bearer token validates. `userId` stays unset for anonymous/invalid requests.

`packages/server/src/app.ts` — order: `logger()` → `cors()` → `getSupabase` (all `app.use("*", …)`), then `app.get("/health", …)`, then six `app.route(...)` mounts (`/logs`, `/metrics`, `/plan`, `/coach`, `/proposals`, `/wellness`).

## What to implement

1. **Add `requireUser`** to `supabase.ts`, exported alongside `getSupabase`:
   ```ts
   import { createMiddleware } from "hono/factory";
   // ...
   export const requireUser = createMiddleware(async (c, next) => {
     if (!c.get("userId")) {
       return c.json({ error: "unauthorized" }, 401);
     }
     await next();
   });
   ```
   (Returning the response short-circuits — do not call `next()` in the unauthorized branch.)

2. **Apply it in `app.ts`** so it runs after `getSupabase` for every route **except** `/health`. Keep `/health` reachable without a token. The clean way: guard each protected mount, or apply `requireUser` to a path scope that excludes `/health`. Mount `/health` first, then `app.use("*", requireUser)` will also intercept `/health` — so instead apply the guard per-group, e.g.:
   ```ts
   app.use("/logs/*", requireUser);
   app.use("/metrics/*", requireUser);
   app.use("/plan/*", requireUser);
   app.use("/coach/*", requireUser);
   app.use("/proposals/*", requireUser);
   app.use("/wellness/*", requireUser);
   ```
   placed after `getSupabase` and after the `/health` definition (order of `use` vs `route` matters in Hono — `use` for a path must be registered before the matching `route`). Pick whichever clean approach keeps `/health` open and guards the other six; document your choice in a comment.

3. **(Optional but encouraged) one test** under `packages/server` (vitest, using `app.request("/wellness/injury-flags")` with no auth header → expect `401`, and `/health` with no auth → expect `200`). If the server package has no test runner configured and adding one is out of scope/time, skip the test and instead verify by typecheck + a reasoned read; note it in the Result.

## Conventions

- TypeScript strict, ESM/NodeNext — server imports use the `.js` extension (`./middleware/supabase.js`). Match exactly.
- No `any`. Keep the JSON error shape simple and consistent (`{ error: "unauthorized" }`).

## Verify (must pass)

```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/server typecheck   # tsc --noEmit, exit 0
pnpm --filter @smart-trainer/server build        # exit 0
```
If you added a test: `pnpm --filter @smart-trainer/server test` green. If running the server end-to-end isn't possible in your sandbox (needs Supabase env), verify by typecheck + logic read and say so.

## When done — record your result (required)

Append a `## Result (P15 — completed <date>)` section to the bottom of THIS file: branch name + commit hash, exactly which files changed and how you kept `/health` public, how you verified (typecheck exit codes, test result if any), and anything for the PM to check. Commit on `feat/auth-401-guard` with a message referencing **P15**.
