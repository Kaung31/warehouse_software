# ScooterHub — production architecture

This is the picture of the system after the production migration.
Every "what" comes with a "why" so the trade-offs are explicit.

```
                         ┌──────────────────────────────┐
                         │    Cloudflare (proxy + DNS)  │
                         │  · SSL terminate             │
                         │  · /cdn-cgi/image/* (CF      │
                         │    Images Transformations)   │
                         │  · cache /_next/static/*     │
                         │  · bypass /api/*, /(dashboard)/* │
                         └──────────────┬───────────────┘
                                        │
                          ┌─────────────┴──────────────┐
                          │                            │
                ┌─────────▼─────────┐        ┌────────▼─────────┐
                │  Railway: web     │        │  Railway: worker │
                │  Next.js 16       │        │  Trigger.dev     │
                │  (2× standalone)  │        │  (1× node)       │
                │                   │        │                  │
                │  · server compo-  │        │  · notify-status │
                │    nents + RSC    │        │  · send-link     │
                │  · /api/*         │        │  · daily-stale   │
                │  · /(public)/*    │        │  · process-photo │
                │                   │        │  · daily-backup  │
                └────┬─────┬────────┘        └─────────┬────────┘
                     │     │                           │
                     │     │                           │
        ┌────────────▼┐    │   ┌─────────────────┐     │
        │ Clerk       │    │   │ Upstash Redis   │     │
        │  · auth     │    │   │  · rate limit   │◄────┤
        │  · webhooks │    │   │  · cache        │     │
        └─────────────┘    │   │  · part locks   │     │
                           │   └─────────────────┘     │
                           │                           │
                           │   ┌─────────────────┐     │
                           ├──►│ Neon Postgres   │◄────┤
                           │   │  · pooled URL   │     │
                           │   │  · DIRECT_URL   │     │
                           │   │  · branch / PR  │     │
                           │   └─────────────────┘     │
                           │                           │
                           │   ┌─────────────────┐     │
                           ├──►│ Cloudflare R2   │◄────┤
                           │   │  · photos       │     │
                           │   │  · backups      │     │
                           │   └─────────────────┘     │
                           │                           │
                           │   ┌─────────────────┐     │
                           └──►│ Pusher Channels │     │
                               │  · case-*       │     │
                               │  · dashboard-*  │     │
                               │  · user-*       │     │
                               └─────────────────┘     │
                                                       │
        ┌──────────────────────────────────────────────┴──────────┐
        │                                                          │
        │  Outbound (third parties — webhooks come back inbound)   │
        │                                                          │
        │  Resend      → email send                                │
        │  Twilio      → SMS send                                  │
        │                                                          │
        │  Observability (push-based, fan-in)                      │
        │                                                          │
        │  Sentry      ← errors, slow queries, source maps         │
        │  Better Stack← pino logs, uptime monitor, status page    │
        │  PostHog     ← session replay, feature flags             │
        └──────────────────────────────────────────────────────────┘
```

## Why each piece

### Hosting — Railway

- Persistent Node containers (no Vercel-style cold starts on the
  worker, important for Trigger.dev).
- Native WebSockets if we ever drop Pusher for self-hosted Soketi.
- Predictable resource pricing rather than per-invocation.
- Two services in one project: `web` (Next.js) + `worker`
  (Trigger.dev). They share env vars via Railway's "Shared Variables".

### Database — Neon

- **Pooled URL** for runtime traffic. Pgbouncer-style transaction
  pooling means we can have 50+ HTTP requests fan out to 5 actual
  Postgres connections.
- **`DIRECT_URL`** for migrations. `prisma migrate` issues DDL,
  which transaction-pooled connections can't proxy.
- **Branch-per-PR** workflow gives each PR a real DB. No "schema
  drifted in staging" problems.
- Built-in PITR + our daily logical backup to R2 for geographic
  redundancy and 30-day retention.

### Cache + locks — Upstash Redis

- HTTP-based Redis (no persistent TCP), which works perfectly behind
  Railway's serverless edge.
- Rate limiter, dashboard cache, and stock locks all in one place.
- Free tier comfortably handles our traffic (~60 users); paid tier
  if we breach 10k commands/day.

### Background jobs — Trigger.dev

- TS-native (no YAML, no DSL, just `task()`).
- Keeps Resend / Twilio / pre-warm out of the request path so the API
  stays fast.
- Replaces the old inline `notifyStatusChange()`. Same code runs in
  the worker now.

### Real-time — Pusher (Sandbox tier)

- Free up to 200 connections. We're at ~60.
- Self-hosting Soketi later is a swap of one URL — same client
  library.

### Image pipeline — Cloudflare Images Transformations

- Origin still R2 (no double storage cost).
- `/cdn-cgi/image/<params>/<r2-presigned-url>` returns AVIF/WebP at
  the requested size on first hit, cached at the edge.
- Customer tracker delivers ~30 KB photos instead of 4 MB originals.

### Email + SMS — Resend Pro + Twilio

- Already integrated; webhooks added in Phase 3 close the loop on
  delivery state.

### Observability — Sentry, Better Stack, PostHog

- **Sentry** catches exceptions, attaches Clerk userId + correlation
  id, surfaces slow Prisma queries (>500 ms) as warning events.
- **Better Stack** ingests structured pino logs and runs the uptime
  monitor against `/api/health`. Public status page lives under their
  free tier.
- **PostHog** session replay (10 % regular, 100 % on errors) +
  feature flags. Form inputs masked by default for privacy.

## Request lifecycle (post-migration)

```
   Browser
   │
   │ HTTPS through Cloudflare
   ▼
   Railway web instance
   │
   │ Clerk middleware (src/proxy.ts) checks auth
   │
   ▼
   Route handler (api/* or page server component)
   │
   │ withErrorHandler wraps:
   │   - generates correlationId
   │   - reads Clerk session
   │   - adds Sentry user context
   │   - times the handler
   │
   ▼
   Business logic
   │
   ├──► cached(key, factory)         (Upstash hit/miss)
   ├──► withPartLock(partId, fn)     (Upstash SET-NX)
   ├──► prisma.* mutation            (Neon, pooled)
   ├──► broadcastCaseUpdate(...)     (Pusher trigger)
   ├──► enqueue("notify-...")        (Trigger.dev)
   │
   ▼
   apiSuccess(...)  ─►  x-correlation-id stamped on response
                    ─►  pino "request ok" with duration

   (Async, in worker process)
   Trigger.dev task picks up the queued job:
   ─►  resolves customer + scooter
   ─►  builds tracking URL with fresh JWT
   ─►  Resend.send / Twilio.send
   ─►  CustomerNotification row → SENT or FAILED
   ─►  Resend / Twilio webhook later updates → DELIVERED / BOUNCED
```

## Privacy / security boundaries

- **Public pages (`/track/*`)** never see internal status enum
  strings, addresses, staff names, prices, recharge details, or
  repair-stage photos. Strict whitelist serializer in
  `lib/trackPublicSerializer.ts`.
- **Tokens** sign only `{ orderId, exp }` — no PII in the JWT.
  1-hour TTL.
- **Rate limit** on `/api/track/lookup` prevents enumeration.
- **Webhooks** from Resend, Twilio, and Clerk all verify
  signatures.
- **Logging** redacts Authorization headers, cookies, body.email,
  body.phone, body.recipient, body.body before pino emits.
- **Session replay** masks form inputs by default (Sentry + PostHog).
