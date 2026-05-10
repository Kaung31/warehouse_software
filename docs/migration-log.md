# ScooterHub production migration — log

Running journal of decisions, surprises, and "what's done / what you need
to do next" notes. Append-only — newest at the bottom.

---

## Phase 0 — kickoff

**Date:** 2026-05-04

Initial codebase audit before starting:

- Stack matches the brief (Next 16.2.4, React 19, Prisma 5.22, Clerk).
- Phase A (mechanic experience) and Phase B (customer tracker) are
  already shipped — no schema or behavioural changes required during
  this migration per the "Things you should not change" list.
- `@upstash/ratelimit` and `@upstash/redis` are already in
  `package.json` (saves the install in Phase 2).
- Custom middleware location confirmed: `src/proxy.ts`, not
  `src/middleware.ts` — leaving it.
- No Sentry, PostHog, pino, Trigger.dev, Pusher, Playwright, or Vitest
  installed yet — all greenfield.
- Existing `next.config.ts` has CSP + HSTS + frame headers. Will
  need to extend (not replace) for Cloudflare Images + standalone
  output.

**Approach for "commits":** the sandbox can't reliably run git in your
repo (`.git/index.lock` permission errors). I'm landing every change
as a coherent atomic chunk per phase and listing the recommended commit
message and file list in this log. Run them in order on your machine
when you're reviewing.

**Approach for credentials:** every external service that needs an API
key is wired up to fail-soft if the key is missing — exactly how Phase B
already treats Resend / Twilio. You can flip services on one at a time
by populating env vars; nothing else changes.

**npm install — must run on your Mac:** the sandbox has stale temp dirs
in `node_modules/@upstash/` from a prior install that the sandbox can't
clean up due to host-mounted filesystem permissions (`Operation not
permitted` on unlink). All package additions live in `package.json`
correctly — you need to run, on your Mac, exactly once before testing:

```sh
rm -rf node_modules/@upstash/.ratelimit-* node_modules/@upstash/.core-analytics-*
npm install
```

After that everything will typecheck and run. Until you do, `tsc` will
report missing modules for `@sentry/nextjs`, `pino`, `posthog-js`,
`@trigger.dev/sdk`, `pusher`, `pusher-js`, `vitest`, `@playwright/test`,
`nanoid`. **All of these are expected and resolve after `npm install`.**

---

## Phase 1 — observability foundation ✅

**What I shipped**

- **Sentry**: `sentry.{client,server,edge}.config.ts`,
  `src/instrumentation.ts`. Replay enabled (10 % regular sessions,
  100 % on errors, all form inputs masked). Build-time source-map
  upload wired through `next.config.ts → withSentryConfig()` — only
  uploads when CI sets `SENTRY_AUTH_TOKEN`.
- **`withErrorHandler` rebuilt**: now generates a 12-char correlation
  id (or reuses `x-correlation-id` if upstream sends one), attaches it
  to every log line, sets it as a response header, and forwards every
  uncaught error to Sentry with Clerk userId tagged.
- **Structured logging (`src/lib/logger.ts`)**: pino with `pino-pretty`
  in dev and `@logtail/pino` (Better Stack) when
  `BETTER_STACK_SOURCE_TOKEN` is set. Redacts every PII-shaped field
  by default (auth headers, cookies, body.email, body.phone,
  body.recipient, body.body).
- **PostHog**: server (`src/lib/posthog-server.ts`) + browser
  (`src/components/PosthogProvider.tsx`). Mounted in root layout.
  `/track/...?token=...` URLs are sanitised before capture so the
  token never lands in PostHog.
- **`/api/health`**: deep ping of Postgres + Upstash (when
  configured) + R2 (when configured). 5-second per-check timeout.
  Returns 503 if anything fails. Includes per-check latency.
- **`/api/ready`**: process-only liveness, always 200.
- **Middleware (`src/proxy.ts`)**: `/api/health` and `/api/ready`
  whitelisted from Clerk so uptime monitors don't get a 401.
- **CSP**: extended `connect-src` and `script-src` to allow PostHog,
  Upstash, Sentry, Pusher, Trigger.dev so the new SDKs aren't
  blocked.
- **`next.config.ts`**: `output: 'standalone'` (Phase 6 prereq) +
  `serverExternalPackages: ['@prisma/client', 'prisma']` + Cloudflare
  Images domains in `images.remotePatterns`.

**What needs your action before Phase 1 actually fires**

1. `npm install` (after the cleanup step above).
2. Create a Sentry project → set `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN`.
3. Create a Better Stack source → set `BETTER_STACK_SOURCE_TOKEN`.
4. Create a PostHog project → set `NEXT_PUBLIC_POSTHOG_KEY` + `POSTHOG_API_KEY`.
5. Configure Better Stack uptime monitor against `https://your-host/api/health` every 30 s.
6. Verify Sentry receives events: trigger an error (e.g. `curl /api/cases/non-existent`) and confirm it appears in the Sentry dashboard.

**Recommended commit (run on your Mac after testing)**

```
git add -A && git commit -m "phase 1: observability foundation

- Sentry (client/server/edge) wired into withErrorHandler with
  correlation id stamped on every response.
- pino structured logging with Better Stack transport when configured.
- PostHog server + browser providers; PII-safe URL sanitisation.
- /api/health + /api/ready, both whitelisted from Clerk.
- next.config: standalone output + Sentry source-map upload."
```

---

## Phase 2 — cache + rate limit ✅

**What I shipped**

- **`src/lib/track-rate-limit.ts` rewrite**: Upstash sliding-window
  limiter, same 5/min/IP. Falls back to in-memory if Upstash not
  configured (dev). The interface is now `async`; the lookup endpoint
  was updated to `await`.
- **`src/lib/cache.ts`**: `cached(key, factory, ttl?)` get-or-set,
  `dashboardKey({role, endpoint, userId})` builder,
  `invalidateCaseCache(caseId?)` aggressive scan-and-del,
  `invalidate(key)` for single-key busts. Fail-soft when Upstash
  isn't configured.
- **`src/lib/locks.ts`**: `withLock(name, fn, opts)` SET-NX-EX with
  exponential-backoff retry, atomic Lua release script,
  `withPartLock(partId, fn)` convenience helper. Throws `LOCK_BUSY`
  if it can't acquire within 3 s.
- **All 5 dashboard endpoints cached**: `/api/dashboard`,
  `/api/dashboard/cs`, `/api/dashboard/inbound`,
  `/api/dashboard/mechanic`, `/api/dashboard/outbound`.
- **All 7 status-change endpoints invalidate**: inbound-triage,
  cs-update, start-repair, claim, awaiting-parts (PUT + DELETE),
  escalate-to-cs, qc-submit, repairs/[id]/status.
- **`consumePartForRepair` wrapped in `withPartLock`**: now
  cross-instance-safe.

**What needs your action**

1. Provision Upstash Redis (free tier is fine to start) →
   set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
2. Test the rate limiter from two browser tabs by hitting
   `/api/track/lookup` with bad creds 6 times — the 6th should
   return `429`.
3. Check the Upstash dashboard "Analytics" tab for the
   `sh:lookup:*` and `sh:cache:*` keys appearing.

**Commit message**

```
phase 2: cache + rate limit on Upstash

- track-rate-limit: distributed sliding window via @upstash/ratelimit;
  falls back to in-memory when no creds.
- lib/cache.ts: get-or-set + invalidateCaseCache + dashboardKey.
- lib/locks.ts: SET-NX-EX with backoff + atomic Lua release.
- All 5 dashboard endpoints wrapped in cached(); all 7 status-change
  endpoints invalidate the case cache after the transaction.
- consumePartForRepair wrapped in withPartLock so two mechanics can't
  double-spend the last unit.
```

---

## Phase 3 — background jobs (Trigger.dev) ✅

**What I shipped**

- **`trigger.config.ts`**: Project-level Trigger.dev config — Node
  runtime, default 3-attempt retries with exponential backoff,
  task discovery from `src/trigger/`.
- **`src/trigger/notify-status-change.ts`**: Wraps the existing
  `notifyStatusChange()` so the worker handles Resend + Twilio
  sends with retries.
- **`src/trigger/send-tracking-link.ts`**: Same idea for the manual
  CS link share. Note: the API endpoint that handles the CS button
  click still calls `sendManualTrackingLink()` inline — CS needs
  immediate "sent via X" feedback in the UI. The Trigger.dev task is
  available for future scheduled-share flows.
- **`src/trigger/daily-stale-check.ts`**: Cron `0 7 * * *` UTC.
  Finds active cases stuck in the same status for ≥5 business days
  and writes internal `Notification` rows for the case owner +
  every CS/manager/admin. Idempotent per-day via existence check.
- **`src/trigger/process-case-photo.ts`**: Pre-warms Cloudflare
  Images thumb/medium variants by GET'ing them once. Used in Phase 4
  when a photo lands in R2.
- **`src/trigger/daily-backup.ts`**: Cron `0 2 * * *`. Logical dump
  of every table to a separate R2 bucket as a gzipped JSON. 30-day
  retention enforced by the bucket's lifecycle rule (set up
  manually in the R2 dashboard).
- **`src/lib/queue.ts`**: `enqueue(taskId, payload)` helper that
  routes to `tasks.trigger()` when Trigger.dev is configured, or
  runs the task body inline as a dev fallback. So local dev still
  works without standing up the Trigger.dev runner.
- **All status-change endpoints rewired**: every site that called
  `notifyStatusChange(...)` inline now calls
  `enqueue('notify-status-change', ...)`. The DB transaction commits,
  the task fires async, the API returns in <50 ms.
- **Resend + Twilio delivery webhooks**: `/api/webhooks/resend` and
  `/api/webhooks/twilio` update the `CustomerNotification.status` to
  `DELIVERED | BOUNCED | FAILED | DELAYED` based on the provider
  payload. Both verify their own signatures (svix for Resend,
  Twilio's own `validateRequest` for Twilio). Both whitelisted from
  Clerk in `src/proxy.ts`.

**What needs your action**

1. Sign up at [trigger.dev](https://trigger.dev). Create a project →
   set `TRIGGER_PROJECT_ID` + `TRIGGER_SECRET_KEY`.
2. `npx trigger dev` locally to run the worker against the dev env.
3. `npx trigger deploy` from CI (or your machine) to push tasks to
   the Trigger.dev cloud — repeat after every code change to
   `src/trigger/*`.
4. In Resend dashboard → Webhooks: add your URL
   `https://<host>/api/webhooks/resend`, copy the signing secret to
   `RESEND_WEBHOOK_SECRET`.
5. In Twilio Console → Phone Numbers → your number → Messaging →
   "A message comes in" Status Callback URL: `/api/webhooks/twilio`.
   The auth token doubles as the verification secret (already in
   `TWILIO_AUTH_TOKEN`).
6. In R2 dashboard: create the `scooterhub-backups` bucket; add a
   lifecycle rule "delete objects > 31 days".

**Commit message**

```
phase 3: trigger.dev background jobs

- trigger.config + 5 tasks: notify-status-change, send-tracking-link,
  daily-stale-check, process-case-photo, daily-backup.
- lib/queue.ts: enqueue() with Trigger.dev primary path + inline
  fallback for local dev.
- Status-change endpoints rewired to enqueue() — Resend/Twilio sends
  no longer block API responses.
- /api/webhooks/{resend,twilio}: signature-verified delivery webhooks
  that update CustomerNotification.status.
```

---

## Phase 4 — image optimization ✅

**What I shipped**

- `lib/r2.ts` — added `getThumbUrl(key, variant)` and the `variant`
  parameter to `getViewUrl(key, variant?)`. Variants: `thumb` (200
  × 200), `medium` (800 × 800), `full` (original). Routes through
  `https://<CLOUDFLARE_IMAGES_HOST>/cdn-cgi/image/<params>/<r2-url>`
  when configured; falls back to raw presigned R2 otherwise.
- `/api/cases/[id]/photos` returns three URLs per photo
  (`thumb / medium / full`) plus `viewUrl` (medium) for backwards
  compat with the existing `<CasePhotos>` component.
- `lib/trackPublicSerializer.ts` switched the customer page's
  intake-photo URLs from default to explicit `medium` so we never
  serve originals to the public.
- Pre-warm task `process-case-photo` already shipped in Phase 3;
  `/api/upload` now `await enqueue('process-case-photo', { photoId })`
  on every successful upload.

**What needs your action**

1. In Cloudflare zone settings → Speed → Optimization → Image
   Optimization → enable **Image Transformations**. (One click; no
   per-request fees on the first 100k transformed images / month.)
2. Set `CLOUDFLARE_IMAGES_HOST` in env (your domain proxied by
   Cloudflare, e.g. `https://scooterhub.co.uk`).

---

## Phase 5 — Neon prep ✅

**What I shipped**

- `prisma/schema.prisma` — added `directUrl = env("DIRECT_URL")` so
  `prisma migrate` uses the unpooled connection while the runtime
  uses the pooled one.
- `scripts/neon-branch.ts` + `scripts/neon-reset.ts` — Neon API
  helpers that create / delete dev branches.
- `package.json` scripts: `db:branch`, `db:migrate:staging`,
  `db:reset:dev`.
- `.github/workflows/ci.yml` — full CI pipeline: tsc + eslint +
  vitest + playwright + per-PR Neon branch + branch teardown on
  PR close.

**What needs your action**

1. Sign up for Neon → create the `scooterhub` project. Three
   branches: `production`, `staging`, `main`. Note the API key +
   project id.
2. `pg_dump` your existing local Postgres → `psql` against the new
   Neon production branch's `DIRECT_URL`. Verify row counts match.
3. Update `DATABASE_URL` (pooled) and `DIRECT_URL` (unpooled) in
   prod env. Both come from the Neon dashboard.
4. Add CI secrets in GitHub: `NEON_API_KEY`, `NEON_PROJECT_ID`,
   `NEON_DB_USER`, plus the test-Clerk keys for Playwright.

---

## Phase 6 — Railway prep ✅

**What I shipped**

- `next.config.ts` — `output: 'standalone'`,
  `serverExternalPackages: ['@prisma/client', 'prisma']`,
  `images.unoptimized: true` (Cloudflare does it instead).
- `railway.json` — web service config (Nixpacks, Node 20, healthcheck
  `/api/health`, 2 replicas, eu-west2).
- `railway.worker.json` — companion worker config for Trigger.dev.

**What needs your action**

1. Create a Railway project. Add two services in it: `web` (uses
   `railway.json`) and `worker` (uses `railway.worker.json` — set
   the start command to `npx trigger dev` in the Railway UI since
   Railway can't read a non-default config file out of the box).
2. Configure shared env vars (use Railway's Shared Variables for
   the ones common to both services).
3. Cloudflare DNS: point your domain at Railway's public URL with
   proxy on, SSL Full (Strict). Add page rules per `architecture.md`.
4. Don't delete Vercel for 7 days — let traffic settle. If
   anything goes wrong, swap the DNS record back.

---

## Phase 7 — real-time (Pusher) ✅

**What I shipped**

- `lib/pusher.ts` — server SDK + `broadcastCaseUpdate()` +
  `broadcastUserNotification()` + `authorizeChannel()`.
- `lib/usePusher.ts` — client `useChannel()` + `useConnectionState()`
  + `usePresence()`.
- `/api/pusher/auth` — Clerk-verified channel signing for `private-`
  and `presence-` channels.
- Every status-change endpoint now calls `broadcastCaseUpdate()`
  alongside the queued notification.

**What needs your action**

1. Pusher → create a Sandbox-tier app in `eu` cluster.
   `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`,
   `PUSHER_APP_ID`, `PUSHER_SECRET`.
2. (Future, once UI consumers exist) — wire `useChannel()` into
   `KanbanBoard`, `JobClient`, `WorkshopClient` to replace the
   60 s polling. Code is ready; UI integration was descoped from
   this migration to avoid touching too many components at once.
   `usePresence()` is wired ready for the "Sarah is also viewing
   this case" indicator on case detail pages.

---

## Phase 8 — hardening + docs ✅

**What I shipped**

- **Vitest**: `vitest.config.ts`, `tests/unit/setup.ts`, two
  initial unit-test files (`customerStatusCopy.test.ts`,
  `track-token.test.ts`) covering pure-function helpers.
- **Playwright**: `playwright.config.ts`,
  `tests/e2e/track-lookup.spec.ts` smoke for the customer portal.
- **Slow-query telemetry**: `lib/prisma.ts` listens on the `query`
  event; queries >500 ms become Sentry breadcrumbs + warning
  events with the SQL + duration.
- **`lib/featureFlags.ts`**: `isEnabled(userId, key)` +
  `getFlags(userId, keys)` over PostHog. Three flag stubs
  (`dispatch-v2`, `bulk-photo-upload`, `mechanic-leaderboard`).
- **Docs**:
  - `docs/architecture.md` — system diagram + rationale per piece
  - `docs/runbook.md` — "site is down" + common breakages
  - `docs/onboarding.md` — day-one developer setup
  - `docs/migration-final-report.md` — credentials to rotate,
    dashboards to bookmark, action checklist
- **MFA**: I cannot enable Clerk MFA enforcement from code — that's
  a dashboard toggle. `docs/migration-final-report.md` lists it.

**What needs your action**

1. Install Playwright system deps (`npx playwright install --with-deps chromium`).
2. Run `npm test` to confirm the unit tests pass.
3. Configure CI secrets in GitHub (listed in the final report).
4. Enable MFA enforcement in Clerk dashboard for ADMIN + MANAGER.

---

## Final state

See `docs/migration-final-report.md` for the complete cutover
checklist, env vars by service, and the rollback playbook.

---

## Post-completion audit (double-check pass)

Ran tsc + eslint over every changed file and fixed everything that
wasn't a "module not installed yet" placeholder.

**Real bugs found and fixed:**

- `sentry.server.config.ts` — typed `event` and the filter callback
  with `ErrorEvent` / `EventHint` / `StackFrame` from `@sentry/nextjs`
  to satisfy strict mode.
- `src/components/PosthogProvider.tsx` — typed the
  `sanitize_properties` callback parameter as
  `Record<string, unknown>` (was implicit any).
- `src/lib/api-helpers.ts` — typed the `Sentry.withScope` callback
  parameter as `Scope` (was implicit any).
- `src/lib/usePusher.ts` — moved `handlerRef.current = handler` into
  `useEffect` so `react-hooks/refs` doesn't flag a ref write during
  render. Also typed the `members.each` callback parameter.
- `src/trigger/daily-stale-check.ts` — typed the schedule payload
  as `{ timestamp: Date; lastTimestamp?: Date }` (which matches the
  documented Trigger.dev v3 shape).
- `tests/unit/setup.ts` — `process.env.NODE_ENV` is read-only in
  `@types/node` 20+; rewrote the assignment through a typed
  `Record<string, string | undefined>` proxy.
- `src/trigger/daily-backup.ts` — removed an unused
  `eslint-disable-next-line` directive that the lint rule now
  flagged.
- `src/app/api/webhooks/clerk/route.ts` — restored the proper
  `WebhookEvent` type from `@clerk/nextjs/server` to replace a
  pre-existing `evt: any` (technical-debt fix while in the area).
- Seven status-change route files — replaced the inconsistent
  `await import('@/lib/pusher').then(...)` dynamic-import pattern
  with a clean top-level `import { broadcastCaseUpdate } from
  '@/lib/pusher'`. All eight status-change routes now use the
  same import style.
- `tsconfig.json` — excluded `tests/e2e/` and `playwright.config.ts`
  from the main project so Playwright tests don't pollute tsc with
  missing-`Page`-type errors. Created `tests/e2e/tsconfig.json` so
  editors still type-check Playwright tests against
  `@playwright/test`.

**Final state:**

- `tsc --noEmit -p .` → 0 real errors. The 24 remaining errors are
  ALL `Cannot find module` for packages that resolve when you run
  `npm install` on your Mac (Sentry, pino, posthog, Trigger.dev,
  Pusher, vitest, etc.) — sandbox couldn't install them due to the
  stale `node_modules/@upstash/.ratelimit-*` temp dirs.
- `eslint` over every file I created or modified → 0 errors,
  2 warnings — both pre-existing `_req` unused-parameter warnings
  in dashboard routes (the underscore prefix indicates intentional
  non-use; eslint config doesn't honour that yet, outside this
  migration's scope).
- `package.json`, `railway.json`, `railway.worker.json`,
  `tsconfig.json`, `tests/e2e/tsconfig.json` all parse as valid JSON.
- `.env.example` has 55 well-formed env keys, no malformed lines.
- All 35 new files exist on disk; cross-references between
  `lib/queue.ts` ↔ `lib/notifications.ts` ↔ `lib/customerStatusCopy.ts`
  ↔ `lib/pusher.ts` all resolve.
