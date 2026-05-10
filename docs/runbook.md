# ScooterHub — runbook

What to do when things break. Symptom → diagnosis → fix.

## "The site is down"

1. **Check the status page** (Better Stack public status page) and
   `/api/health` directly. The health check returns per-dependency
   latency and pass/fail; that tells you where to look first.
2. **Check Railway logs** for the `web` service. Look for the most
   recent deploy — most outages are deploy-related. Roll back via the
   Railway "Deployments" tab if needed.
3. **Check Sentry** for a spike of errors. The correlation id on
   every error matches the `x-correlation-id` response header — pull
   that from a failing browser tab to find the exact log entries in
   Better Stack.
4. **Check Cloudflare**. If Cloudflare returns a 5xx page (purple
   error), Railway is fine but the proxy can't reach it.

If nothing else works: in Cloudflare DNS, swap the proxy off the
Railway origin and point straight at Vercel (which we keep around for
7 days post-migration as a safety net).

## "Notifications aren't sending"

1. Open the latest `CustomerNotification` rows in Prisma Studio. The
   `status` and `errorMessage` fields tell you what happened.
2. **`status = QUEUED` for >2 minutes**: Trigger.dev worker is
   probably down. Check the `worker` Railway service logs. If it's
   crashed, restart from the Railway UI.
3. **`status = FAILED, errorMessage = "RESEND_API_KEY missing"`**:
   the env var on the worker service isn't populated.
4. **`status = FAILED, errorMessage starts with "Resend"`**: the
   provider rejected. Check the Resend dashboard for delivery
   errors (sender domain unverified, rate limit, etc).
5. **`status = SENT` but customer didn't receive**: check the
   delivery webhook landed — there should be a follow-up `DELIVERED`
   or `BOUNCED` update on the same row. If not, the webhook URL in
   the Resend / Twilio dashboard is wrong.

## "The dashboard shows stale data"

1. The dashboard cache TTL is 5 minutes. Status changes invalidate
   it via `invalidateCaseCache(caseId)`.
2. If staleness persists, hit `/api/health` to confirm Upstash is
   reachable. If `redis.ok = false`, Upstash is down — the cache
   layer fail-soft falls back to direct DB reads, so behaviour is
   slow but correct.
3. Manually flush the cache from the Upstash dashboard:
   `SCAN 0 MATCH sh:cache:* COUNT 1000` then `DEL` the keys (or use
   `FLUSHDB` if you're certain).

## "Stock went negative" / "Two mechanics consumed the same part"

This shouldn't be possible — `consumePartForRepair` runs inside
`withPartLock(partId, ...)`. If you see it:

1. Confirm Upstash is reachable. If it isn't, the lock falls back
   to no-op (single-process only) — that's the most likely cause.
2. Inspect the `StockMovement` table for the offending part. Run a
   manual `adjustStock(...)` to bring stock back into balance.
3. File a Sentry issue with the lock log lines.

## "A user is locked out"

1. **Clerk session**: open the Clerk dashboard → Users → impersonate
   to test. If the user can't log in there, it's a Clerk-side issue
   (their account is suspended, password reset, etc).
2. **MFA enforcement** (ADMIN/MANAGER): they need to enrol via the
   Clerk user-profile UI. There's no admin-side MFA bypass — that's
   intentional.

## "Background job hasn't run"

1. Trigger.dev dashboard → Runs tab. Filter by task id.
2. **No runs at all**: the worker isn't deployed. `npx trigger
   deploy` from your machine or a CI job.
3. **Runs are failing**: click into the run, look at the log output.
   Common causes: env var missing, DB connection limit hit (Neon
   pooled URL handles that — make sure the worker uses the pooled
   URL too).
4. **Scheduled task didn't fire**: check the cron expression. Daily
   tasks run UTC, not BST — they'll be 6 am instead of 7 am during
   British summer time. Adjust if that matters.

## "I broke the local DB"

```sh
npm run db:reset:dev -- --branch-id <your-branch-id>
npm run db:branch
# update DATABASE_URL + DIRECT_URL in .env
npx prisma migrate deploy
npx prisma db seed
```

## Post-deploy smoke tests (do these every deploy)

1. `curl https://<host>/api/health` → 200 with all checks `ok: true`
2. Open `/dashboard` as ADMIN — should load in <500 ms (cache hit
   on the second load).
3. Open `/workshop` as MECHANIC — should redirect from `/dashboard`.
4. Open `/track` and look up RO-000001 → should land on the detail
   page with the 5-step pipeline.
5. Hit `curl /api/cases/non-existent` → 500 + Sentry should record
   it within 30 s.

## Rollback playbook

1. Railway → Deployments → click the previous good deploy → Redeploy.
2. If schema changed: roll the migration manually with `prisma
   migrate resolve --rolled-back <name>` in CI, then redeploy.
3. If data changed: restore from the most recent R2 backup (see the
   `daily-backup.ts` task — JSON gzipped, restoration is `psql` +
   `jq` or a small Node script).

## On-call escalation

- **App issues** (Sentry / Railway): Kai
- **Database** (Neon): Kai
- **DNS / Cloudflare**: Kai
- **Third parties down** (Resend, Twilio, Pusher): nothing to do
  but wait + check the provider status page; the fail-soft
  notification system means status changes still land in the DB.
