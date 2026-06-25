# Agent Task (P13) — Offline-first logging: IndexedDB outbox + reconnect sync

> **STATUS: DEFERRED — post-v1 fast-follow (v1.1).** Max set v1 testing scope to **online-only** (2026-06-21): first testing happens with signal / logging right after a session. This brief is the **#1 item to pick up once v1 testing starts**, because real field use (crags, trails, no signal) depends on it. The brief below is ready to execute as-is — do not start it before the P22 release lands and online-only testing is underway.

You are working in the **smart-trainer** monorepo (`~/dev/smart-trainer`). A headline non-functional requirement is **"log on bad signal"** — Max trains at crags and on trails with no service, and a logging app that drops a workout because the network blinked is useless. Today the PWA shell + reads are cached (vite-plugin-pwa is configured with a NetworkFirst Supabase cache), but **writes go straight to the network and fail when offline**. This task makes the **write path durable**: queue logging writes in IndexedDB when offline (or on network failure), show them as pending, and **flush them in order when connectivity returns**.

Frontend task, scoped to `packages/web`. It's the largest remaining UI item — read the whole brief and the "Scope" section before starting; resist gold-plating.

## Context: what this project is

A personal mobile-first PWA. Data flow: web → `server` (Hono) → `core` → Supabase. All domain writes go through one tiny API client; auth is a Supabase JWT attached per-request. The injury/coach loops only work if the logs actually land, eventually.

## What already exists (read these first)

- **API client** — `packages/web/src/lib/api.ts`: `request(method, path, body)` fetches `${VITE_API_URL}${path}`, **attaches a fresh Supabase access token at call time** (`supabase.auth.getSession()`), throws `ApiError(status, msg)` on non-2xx. Exposes `api.get/post/put`. **Key fact for sync:** because the token is fetched at send time, a queued write replayed later through this same function automatically gets a *valid, fresh* token — so the outbox should store only `{method, path, body}` and replay via `request`, never a stale token.
- **Mutations** — `packages/web/src/lib/hooks.ts`: `useLoggingMutation(path)` wraps `api.post(path, payload)` and invalidates `["metrics"]/["plan"]/["home"]` on success. The four write hooks that matter for offline are `useLogRun` (`/logs/run`), `useLogClimb` (`/logs/climb`), `useLogStrength` (`/logs/strength`), `useLogCheckIn` (`/logs/checkin`). Skeleton/plan/proposal writes are **out of scope** (see Scope).
- **Service worker** — `packages/web/vite.config.ts`: `VitePWA({ registerType: "autoUpdate", … , workbox.runtimeCaching: [NetworkFirst for *.supabase.co] })`. The shell + reads are already cached. `vite-plugin-pwa@^0.20` is a dep. There is **no write queue** yet.
- **App root** — `packages/web/src/main.tsx` (QueryClientProvider → AuthProvider → Router). A small online/offline status context can mount here.

## Scope — do exactly this, not more

**In scope:** durable, eventually-consistent **logging writes** — the four `/logs/*` mutations. That's the "log on bad signal" requirement.

**Out of scope (note as future, don't build):** offline plan authoring, skeleton edits, goal CRUD, and proposal approve/reject. Those are interactive/coach-driven and rarely happen off-grid; queuing them invites ordering/conflict problems not worth it now. Reads are already cached — don't re-architect them.

## What to implement

1. **Add an IndexedDB outbox.** Use the tiny `idb` library (`pnpm --filter @smart-trainer/web add idb`) rather than raw IndexedDB. Create `packages/web/src/lib/outbox.ts`:
   - A store `outbox` keyed by a client-generated `id` (`crypto.randomUUID()`), each record `{ id, method, path, body, kind, createdAt, attempts }` where `kind` is a human label ("run"/"climb"/"strength"/"checkin") for the pending UI.
   - Functions: `enqueue(entry)`, `allPending()`, `remove(id)`, `bumpAttempts(id)`, and a subscribe mechanism (or a simple event) so the UI can show the count.

2. **Route logging writes through the outbox.** Add `sendOrQueue(method, path, body, kind)` in `lib/api.ts` (or a new `lib/durableApi.ts`):
   - If `navigator.onLine`, try `request(...)`. On success, return the result. On a **network/connection failure** (fetch rejects, or offline), `enqueue(...)` and return a sentinel like `{ queued: true, id }`.
   - **Do not queue on a real server error** (4xx/5xx `ApiError`) — that's a bad request, not a connectivity problem; surface it so the user can fix the input. Only transport failures get queued.
   - Point the four logging mutations (`useLoggingMutation`) at `sendOrQueue` instead of bare `api.post`. Keep the cache-invalidation `onSuccess`; for a *queued* result, optimistically reflect it (see step 4).

3. **Build a sync manager** `packages/web/src/lib/sync.ts`:
   - `flush()` — read `allPending()` **in FIFO order** (oldest `createdAt` first) and replay each via `request(method, path, body)`. On 2xx → `remove(id)`. On transport failure → stop (stay offline, keep the rest queued). On a 4xx that means "already applied / duplicate" or other terminal server response → `remove(id)` (don't wedge the queue on a poison item) and log it; `bumpAttempts` and drop after a small cap (e.g. 5) as a backstop.
   - Trigger `flush()` on: app load (if online + non-empty queue), the `window` `online` event, and after any successful live write (catch-up). Debounce so concurrent triggers don't double-send (a simple in-flight boolean lock).
   - **Last-write-wins / idempotency note:** check-ins are naturally idempotent (server upserts by `(user_id, check_in_date)`), so replays are safe. Run/climb/strength logs are **not** idempotent — a replay after a "committed but response lost" case could duplicate. Accept this bounded risk for now (flush removes each item on 2xx; only transport failures re-queue). Document it in your Result and propose a follow-up: a client-generated `client_token` column on `sessions` for true idempotency (a future migration — **do not** add a migration in this task; P20 just normalized them).

4. **Surface pending state in the UI.**
   - A small **online/offline + pending-count indicator** (e.g. in `NavBar` or a thin banner): "Offline — N entries will sync" / "Syncing N…". Drive it from the outbox subscription + `navigator.onLine` (+ `online`/`offline` listeners), mounted near the app root.
   - Optimistic UX: when a write is queued, the logging form should confirm success to the user ("Saved — will sync when online") rather than erroring, and the relevant react-query caches should be invalidated/refetched once `flush()` lands the real rows.

5. **(Optional) Workbox BackgroundSync alternative.** You *may* instead implement the queue via Workbox's `BackgroundSyncPlugin` on the `/logs/*` routes. It's more "native" but harder to give a visible pending count and last-write-wins control, and it doesn't compose as cleanly with react-query. **Prefer the explicit `idb` outbox above** for visibility and testability; only choose BackgroundSync if you can still deliver the pending-count UI and the FIFO/idempotency semantics. State your choice in the Result.

## Conventions

- TypeScript strict; web imports use `.ts`/no-extension. No `any` on public surfaces.
- Keep modules small and pure where possible: `outbox.ts` (storage), `sync.ts` (flush/orchestration), a tiny `useOnlineStatus()` / `usePendingCount()` hook for the UI. This separation is what makes the logic testable without a browser.
- Only one new dependency (`idb`). Don't pull in a sync framework.

## Tests / verification

```bash
cd ~/dev/smart-trainer
pnpm --filter @smart-trainer/web add idb
pnpm --filter @smart-trainer/web typecheck     # exit 0
pnpm --filter @smart-trainer/web build         # exit 0 (PWA + SW build)
```
Manual offline test (do this if you can run the app, it's the real proof): load the app online, open DevTools → Network → **Offline**, log a run + a check-in (forms should confirm "saved, will sync", indicator shows 2 pending), go back **Online**, confirm the outbox drains in order and the entries appear in Progress/Home after refetch. If you can extract the FIFO + "queue only on transport failure" + last-write-wins decisions into pure functions, add a couple of unit checks for them and note it; otherwise verify by the offline walkthrough + logic read.

## Guardrails

- **Writes must never be silently lost.** A failed/queued write must end up in IndexedDB before the user is told it's saved. Confirm the `enqueue` resolves before the optimistic success.
- **Don't queue server-rejected writes** (4xx/5xx) — only transport failures. A 400 means fix the input, not retry forever.
- **Don't widen scope** to skeleton/goals/proposal writes or to reads.
- **No new migration** and no backend changes — this is entirely in `packages/web`. (Idempotency column is a noted future, not this task.)
- Don't break the existing online happy path — when connected, behavior should be indistinguishable from today (plus the indicator).

## When done — record your result (required)

Append a `## Result (P13 — completed <date>)` section to the bottom of THIS file: branch + commit hash, the modules added (`outbox.ts`/`sync.ts`/hooks/indicator) and how data flows online vs offline, which mutations are covered, how FIFO + "queue only on transport failure" + last-write-wins are enforced, the idempotency limitation + proposed `client_token` follow-up, the new dep, how you verified (typecheck/build + the offline walkthrough result), and anything for the PM. Branch `feat/offline-first`, commit message referencing **P13**; open a PR to `main` or note it's ready.
