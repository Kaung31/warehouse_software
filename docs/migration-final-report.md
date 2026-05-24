# ScooterHub production migration — final report

This is what shipped, where it lives, what credentials need rotating,
and what a "site is down" runbook looks like in one page.

## TL;DR

| Phase | What                          | Status                                  |
| ----- | ----------------------------- | --------------------------------------- |
| 1     | Sentry + pino + PostHog + health | ✅ code complete, needs DSN/keys     |
| 2     | Upstash rate limit + cache + locks | ✅ code complete, needs URL/token   |
| 3     | Trigger.dev (5 tasks) + webhooks | ✅ code complete, needs project + keys |
| 4     | Cloudflare Images Transformations | ✅ code complete, needs zone host    |
| 5     | Neon prep + branch CI workflow | ✅ code complete, needs Neon project    |
| 6     | Railway hosting (railway.json) | ✅ config complete, needs deployment    |
| 7     | Pusher real-time              | ✅ code complete, needs project + keys  |
| 8     | Tests + slow-query log + flags + docs | ✅ done                          |

## What's running where

| Concern        | Service                              |
| -------------- | ------------------------------------ |
| Web            | Railway "web" service (2× standalone)|
| Worker         | Railway "worker" service (1× node)   |
| Database       | Neon Postgres (Launch tier)          |
| Cache + locks  | Upstash Redis (free tier OK to start)|
| Files          | Cloudflare R2 (existing bucket)      |
| Image transform| Cloudflare Images Transformations    |
| Background jobs| Trigger.dev cloud                    |
| Email          | Resend Pro                           |
| SMS            | Twilio                               |
| Real-time      | Pusher Channels (Sandbox tier)       |
| Auth           | Clerk Pro                            |
| Errors         | Sentry (Team tier)                   |
| Logs + uptime  | Better Stack                         |
| Replay + flags | PostHog                              |

## Env vars by service

The full list lives in `.env.example`. Group by where they belong:

**Both Railway services (web + worker):**

```
DATABASE_URL          (Neon pooled)
DIRECT_URL            (Neon unpooled)
TRACK_TOKEN_SECRET
NEXT_PUBLIC_APP_URL
RESEND_API_KEY
NOTIFICATION_FROM_EMAIL
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
RESEND_WEBHOOK_SECRET
TWILIO_WEBHOOK_SECRET
SENTRY_DSN
SENTRY_RELEASE                (set by CI to git SHA)
SENTRY_ENVIRONMENT
BETTER_STACK_SOURCE_TOKEN
POSTHOG_API_KEY
POSTHOG_HOST
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
TRIGGER_PROJECT_ID
TRIGGER_SECRET_KEY
PUSHER_APP_ID
PUSHER_SECRET
NEXT_PUBLIC_PUSHER_KEY
NEXT_PUBLIC_PUSHER_CLUSTER
NEXT_PUBLIC_SENTRY_DSN
NEXT_PUBLIC_SENTRY_ENVIRONMENT
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
CLOUDFLARE_IMAGES_HOST
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
R2_BACKUP_BUCKET, R2_BACKUP_ACCESS_KEY_ID, R2_BACKUP_SECRET_ACCESS_KEY
NEON_API_KEY, NEON_PROJECT_ID                       (worker only — the daily-stale-check / backup tasks)
```

**CI-only:**

```
SENTRY_AUTH_TOKEN     (uploads source maps)
SENTRY_ORG, SENTRY_PROJECT
NEON_DB_USER          (for the branch-creation action)
CLERK_*_TEST          (Playwright sandbox creds)
```

**Cloudflare DNS layer (no env vars, configured in dashboard):**

- Proxy enabled in front of Railway
- SSL: Full (Strict)
- Page rule: cache `/_next/static/*` aggressively
- Page rule: bypass cache on `/api/*`, `/(dashboard)/*`, `/track`,
  `/track/*`
- Cloudflare Images Transformations enabled on the zone (one-click
  in the Speed → Optimization → Images tab)

## Credentials to rotate before going live

I've left every secret blank in your `.env`. Provision the
following and paste in:

1. **Sentry** → DSN + auth token + project name
2. **Better Stack** → source token (logs) + uptime monitor URL
3. **PostHog** → public + private key (EU host)
4. **Upstash** → REST URL + token
5. **Trigger.dev** → project id + secret key (`tr_pat_...`)
6. **Cloudflare Images** → zone host (e.g. `https://scooterhub.co.uk`)
7. **Neon** → API key + project id + per-branch `DATABASE_URL` and
   `DIRECT_URL`
8. **Pusher** → app id + key + secret + cluster
9. **Resend** → webhook signing secret (Resend dashboard → Webhooks)
10. **Twilio** → keep `TWILIO_AUTH_TOKEN`; the same token validates
    inbound webhooks

Existing creds (Clerk, Resend API key, Twilio credentials, R2) carry
over unchanged.

## Dashboards to bookmark

| Service       | URL                                                        |
| ------------- | ---------------------------------------------------------- |
| Sentry        | https://sentry.io/organizations/<org>/issues/              |
| Better Stack  | https://logs.betterstack.com (logs) + status page URL      |
| PostHog       | https://eu.posthog.com/project/<id>/                       |
| Upstash       | https://console.upstash.com/redis                          |
| Trigger.dev   | https://cloud.trigger.dev/orgs/<org>/projects/<id>/runs    |
| Neon          | https://console.neon.tech/app/projects/<id>                |
| Railway       | https://railway.app/project/<id>                           |
| Cloudflare    | https://dash.cloudflare.com/<account>/<zone>               |
| Pusher        | https://dashboard.pusher.com/apps/<id>                     |
| Resend        | https://resend.com/emails                                  |
| Twilio        | https://console.twilio.com/                                |

## "The site is down" — 60-second response

1. **Status page** (Better Stack) — is anything red?
2. **`curl https://<host>/api/health`** — which dependency is failing?
3. **Railway → web service → Logs** — most recent deploy line, look
   for crash + roll back from "Deployments" tab if needed.
4. **Sentry** — spike of errors? Pull a recent
   `x-correlation-id` from a failing browser tab, search Better Stack
   logs.
5. **Cloudflare** — purple error page = proxy issue, not Railway. In
   DNS, swap proxy off and point straight at Railway's public URL
   to bypass.
6. **Last resort** — Cloudflare DNS → swap DNS to the still-running
   Vercel deployment (which we keep live for 7 days post-cutover).

Detailed playbook in `docs/runbook/index.md`.

## Files added

```
docs/architecture.md              system diagram + rationale
docs/runbook.md                   "site is down" + common breakages
docs/onboarding.md                day-one developer setup
docs/migration-log.md             phase-by-phase journal
docs/migration-final-report.md    you are here

next.config.ts                    + standalone, + Sentry, + CSP
trigger.config.ts                 Trigger.dev project config
railway.json + railway.worker.json deployment configs
playwright.config.ts              E2E setup
vitest.config.ts                  unit test setup

sentry.client.config.ts           browser SDK init
sentry.server.config.ts           Node SDK init
sentry.edge.config.ts             Edge SDK init
src/instrumentation.ts            loads the right Sentry per runtime

src/lib/logger.ts                 pino + Better Stack
src/lib/posthog-server.ts         server analytics + flags
src/components/PosthogProvider.tsx browser bootstrap
src/lib/cache.ts                  Upstash get-or-set + invalidation
src/lib/locks.ts                  Upstash distributed locks
src/lib/queue.ts                  enqueue() with Trigger.dev + inline fallback
src/lib/pusher.ts                 server-side broadcasts
src/lib/usePusher.ts              client hook
src/lib/featureFlags.ts           PostHog flag wrapper

src/trigger/notify-status-change.ts
src/trigger/send-tracking-link.ts
src/trigger/daily-stale-check.ts
src/trigger/process-case-photo.ts
src/trigger/daily-backup.ts

src/app/api/health/route.ts       deep ping (DB + Redis + R2)
src/app/api/ready/route.ts        process-only liveness
src/app/api/pusher/auth/route.ts  per-channel signed auth
src/app/api/webhooks/resend/route.ts  delivery webhook
src/app/api/webhooks/twilio/route.ts  delivery webhook

scripts/neon-branch.ts            CLI: create branch off production
scripts/neon-reset.ts             CLI: delete + recreate branch

.github/workflows/ci.yml          tsc + eslint + vitest + playwright
                                  + per-PR Neon branch
tests/unit/customerStatusCopy.test.ts
tests/unit/track-token.test.ts
tests/unit/setup.ts
tests/e2e/track-lookup.spec.ts
```

## Files modified

```
package.json                       new deps + scripts
prisma/schema.prisma               directUrl added to datasource
prisma/seed.ts                     unchanged from Phase B
src/proxy.ts                       whitelisted health/ready/webhooks
src/lib/api-helpers.ts             rewritten with Sentry + correlationId + pino
src/lib/r2.ts                      Cloudflare Images variant URLs
src/lib/prisma.ts                  slow-query → Sentry breadcrumbs
src/lib/track-rate-limit.ts        in-memory → Upstash sliding window
src/app/layout.tsx                 PostHog provider mounted
src/app/api/dashboard/route.ts            cached() wrap
src/app/api/dashboard/cs/route.ts         cached() wrap
src/app/api/dashboard/inbound/route.ts    cached() wrap
src/app/api/dashboard/mechanic/route.ts   cached() wrap
src/app/api/dashboard/outbound/route.ts   cached() wrap
src/app/api/cases/[id]/inbound-triage/route.ts  + invalidate + enqueue + Pusher
src/app/api/cases/[id]/cs-update/route.ts        + invalidate + enqueue + Pusher
src/app/api/cases/[id]/start-repair/route.ts     + invalidate + enqueue + Pusher
src/app/api/cases/[id]/claim/route.ts            + invalidate + enqueue + Pusher
src/app/api/cases/[id]/awaiting-parts/route.ts   + invalidate + enqueue + Pusher
src/app/api/cases/[id]/escalate-to-cs/route.ts   + invalidate + enqueue + Pusher
src/app/api/cases/[id]/qc-submit/route.ts        + invalidate + enqueue + Pusher
src/app/api/repairs/[id]/status/route.ts         + invalidate + enqueue + Pusher
src/app/api/cases/[id]/photos/route.ts           thumb + medium + full URLs
src/app/api/upload/route.ts                      + enqueue process-case-photo
src/lib/trackPublicSerializer.ts                 medium variant for customer page
src/lib/stock.ts                                 wrapped in withPartLock
.env.example                                     every new env var documented
```

## What's NOT done (your action)

These need clicking around in vendor dashboards or running on a host
with credentials I don't have from the sandbox:

1. **Run `npm install`** on your Mac (after deleting the stale
   `node_modules/@upstash/.ratelimit-*` and `.core-analytics-*`
   temp dirs that the sandbox couldn't unlink).
2. **Provision every service** (Sentry, PostHog, Upstash, Neon,
   Railway, Trigger.dev, Pusher, Cloudflare Images, Better Stack).
   Paste the resulting credentials into the env vars above.
3. **Run `pg_dump`** on your existing local Postgres → restore into
   the new Neon production branch. (The `daily-backup` task we built
   handles ongoing backups; the initial migration is one-off.)
4. **Deploy to Railway**: connect the GitHub repo, create the two
   services (web + worker), set the start commands per
   `railway.json` / `railway.worker.json`, point a Cloudflare DNS
   record at the web service.
5. **Cloudflare configuration**: enable proxying in front of
   Railway, turn on Images Transformations on the zone, add the page
   rules listed above.
6. **Webhook URLs in Resend + Twilio dashboards** pointing at
   `https://<host>/api/webhooks/resend` and `/api/webhooks/twilio`.
7. **Create the `scooterhub-backups` R2 bucket** with a 31-day
   lifecycle rule.
8. **Enable MFA enforcement in Clerk** for ADMIN + MANAGER roles
   (Clerk dashboard → Settings → User & Authentication →
   Multi-factor → "Required for these roles").
9. **Create CI secrets** in GitHub: `NEON_API_KEY`,
   `NEON_PROJECT_ID`, `NEON_DB_USER`, `SENTRY_AUTH_TOKEN`,
   `CLERK_PUBLISHABLE_KEY_TEST`, `CLERK_SECRET_KEY_TEST`,
   `TRACK_TOKEN_SECRET_TEST`.
10. **Run `npx trigger deploy`** once with `TRIGGER_SECRET_KEY` set
    to push the 5 tasks to Trigger.dev cloud.

## Verification checklist (after step 10)

- [ ] `curl https://<host>/api/health` returns 200 with all
      dependencies `ok: true`.
- [ ] Trigger.dev dashboard shows the 5 tasks registered.
- [ ] Triggering a case status change (e.g. inbound triage) creates
      a `CustomerNotification` row → marks SENT within 30 s →
      Resend webhook flips it to DELIVERED within a minute.
- [ ] Two browser tabs on `/cases/RO-XXX` — change status in one,
      the other updates within 1 s without refresh.
- [ ] Open `/track` → look up RO-000001 → page shows the 5-step
      pipeline + ETA + intake photos at ~30 KB each (check
      DevTools Network tab).
- [ ] Sentry receives a deliberate test error from `/api/health`
      (force a Postgres failure by stopping Neon for 10 s — the
      503 should generate a Sentry event with the correlationId).

That's it. Let me know what to tackle first.
