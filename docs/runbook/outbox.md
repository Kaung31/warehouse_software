# Runbook — outbox dispatcher

## When you'll reach for this

A Sentry alert fired for `component=outbox`, a customer reports
"didn't get my email", a dashboard isn't refreshing after a status
change, or you noticed `outbox_event` rows piling up in a routine
check. This document is how you triage and fix it.

The full architectural story lives in
`docs/adr/0001-audit-log-and-outbox.md` — read that first if any of
the terms below are unfamiliar (audit-write-allowed scope,
at-least-once dispatch, dead letter, eventId-as-idempotency-key).

## Mental model in three sentences

1. Every business mutation that goes through `withAuditedTransaction`
   commits an `outbox_event` row alongside the business writes.
2. A scheduled task drains the table once a minute (in 2-second ticks
   internally), runs the handler registered in
   `src/trigger/outbox-dispatch-table.ts`, and sets `processed_at` on
   success.
3. Failures bump `attempts` and schedule a backoff retry. After
   `max_attempts` (default 10) the row stays `processed_at = NULL`
   forever as a dead letter, and Sentry fires.

That's the whole machine. Everything below is "what to type when X."

## Dashboards / queries you'll actually run

All queries assume you're connected to the production DB (Neon
console, `psql`, or whatever you use). Read-only is fine for
inspection; manual replay needs write access.

### How many events are unprocessed right now?

```sql
SELECT count(*) AS unprocessed
FROM   outbox_event
WHERE  processed_at IS NULL;
```

Healthy steady state: this number drops to 0 within ~2 seconds of any
emit. Sustained > 0 means the dispatcher is behind, dead, or there's
a handler stuck retrying.

### Show me the unprocessed events with their attempts and next-retry time

```sql
SELECT id,
       event_type,
       aggregate_id,
       attempts,
       max_attempts,
       available_at,
       last_error,
       created_at
FROM   outbox_event
WHERE  processed_at IS NULL
ORDER  BY available_at ASC
LIMIT  100;
```

Reading the result:

- `available_at` in the past → row is **eligible right now**, the
  dispatcher should pick it up within 2 s on the next tick.
- `available_at` in the future → row is in **backoff**, waiting for
  its retry window. Expected after a transient failure.
- `attempts >= max_attempts` AND `processed_at IS NULL` → **dead
  letter**. See next section.
- `attempts = 0` AND old `created_at` → the dispatcher hasn't run.
  Check the worker dyno.

### Show me dead-lettered events

```sql
SELECT id,
       event_type,
       aggregate_id,
       attempts,
       max_attempts,
       last_error,
       created_at,
       (NOW() - created_at) AS age
FROM   outbox_event
WHERE  processed_at IS NULL
  AND  attempts >= max_attempts
ORDER  BY created_at ASC;
```

These rows will never be retried automatically. They are persistent
evidence of "we tried, we failed, we gave up." A human (you) decides
what to do with each one.

### How many events of each type fired in the last 24 hours

```sql
SELECT event_type,
       count(*)                                        AS total,
       count(*) FILTER (WHERE processed_at IS NULL)    AS still_unprocessed,
       count(*) FILTER (WHERE attempts >= max_attempts AND processed_at IS NULL) AS dead
FROM   outbox_event
WHERE  created_at > NOW() - INTERVAL '24 hours'
GROUP  BY event_type
ORDER  BY total DESC;
```

Useful when product asks "did the cs-update flow run today" or when
you're sanity-checking after a deploy.

## Sentry alert taxonomy

The dispatcher uses tags to differentiate the four alert classes.
Filter on `tags.component = "outbox"` to see only this surface.

### `tags.outbox_state = "no_handler"` (warning)

Message: `Outbox: no handler registered for event_type="..."`.

**What it means:** the producer (some `emit()` call) used an
`event_type` that isn't a key in `dispatchTable`. The dispatcher
marks the row processed with `last_error = 'no_handler'` and stops
retrying. **No customer impact** for this row, but the side-effect
that the producer expected to happen did not happen.

**Cause, almost always:** a deploy gap. Either the producer is on a
new version and the dispatcher worker hasn't rolled forward, or
someone added an `emit()` without adding the corresponding
`dispatchTable` entry.

**Fix:**
1. Check the producer side: search the codebase for the exact
   `event_type` string. Confirm both the producer and the dispatch
   table are on the same deploy.
2. If the table entry is missing, add it (one-line registration in
   `outbox-dispatch-table.ts`), redeploy.
3. The already-marked-processed rows won't auto-fire — if the missed
   side-effect mattered (e.g. customer email never sent), you'll
   need to manually re-emit. See "manually retry a stuck event"
   below for the pattern (set `processed_at = NULL`, `attempts = 0`,
   `last_error = NULL`, `available_at = NOW()`), but only after the
   handler is registered.

### `tags.outbox_state = "dead"` (error)

Message: the original handler exception, with the row's `eventId`,
`aggregateId`, `attempts`, `maxAttempts`, and full payload in
`extra`.

**What it means:** the handler threw 10 times in a row (or however
many `max_attempts` was set to for that event), exponential backoff
ran out, and the row is now sitting at `processed_at = NULL` as
permanent evidence. **Customer impact is event-specific** — read the
payload to know what didn't happen.

**Cause:**
- A persistent downstream outage (Pusher down for an hour, Resend
  rejecting all sends because the API key rotated, etc.). Look at
  `last_error` — it'll usually tell you which downstream.
- A bug in the handler itself — Zod parse failure on a payload shape
  drift, an unhandled exception path. Same `last_error` story.
- A poisoned payload — malformed data that no amount of retry will
  fix. These look like Zod failures or `TypeError`s in `last_error`.

**Fix sequence:**
1. **Read `last_error`.** Decide if this is a transient issue
   (downstream outage that's now resolved) or a poisoned payload
   (the handler will throw the same error forever).
2. **For transient issues**, after the downstream is back up:
   manually retry — see the next subsection.
3. **For poisoned payloads**: don't retry. The row stays as
   evidence. If the missed side-effect mattered, fix it manually
   (e.g. send the email by hand from Resend's dashboard, post in
   #ops what you did and why).
4. **If the same event_type is dead-lettering repeatedly across
   different aggregateIds**, that's a handler bug, not a payload
   problem. File a ticket and pause new emits of that event_type
   if practical.

### Slow dispatch (no Sentry alert today, monitor manually)

If `dispatcher run complete` log lines (Trigger.dev dashboard or
Better Stack with `service = scooterhub` AND `outbox`) show
`emptyTicks < TICKS_PER_RUN/2` consistently, the dispatcher is
saturated. Either:

- The handler latency went up (slow downstream).
- The emit rate went up (more business activity).

Neither is a bug per se, but it widens the window where a worker
restart loses in-flight work. We have not added a Sentry rule for
this yet (good future improvement) — for now, eyeball it during
incident reviews.

### Backoff exhausted, but not yet dead

There isn't a dedicated alert; this is just an in-progress retry.
You'll see it as `tags.outbox_state` absent (or whatever the test
tag was) and a `failed` row outcome in dispatcher logs. Normal
behaviour — wait for the next retry tick. Only worry if it
graduates to `dead`.

## Manually retry a stuck event

Use case: a downstream outage is over, and you want to push a few
specific dead or backed-off rows through right now without waiting
for the next backoff window.

**Always identify the rows first.** Don't bulk-update the table.

```sql
-- Find the candidates.
SELECT id, event_type, attempts, max_attempts, last_error
FROM   outbox_event
WHERE  processed_at IS NULL
  AND  event_type = 'case.status_changed'
  AND  last_error LIKE '%Pusher%'
ORDER  BY created_at;
```

Eyeball the list, then for each row you actually want to replay:

```sql
-- For ONE specific row.
UPDATE outbox_event
SET    available_at = NOW(),
       attempts     = 0,
       last_error   = NULL
WHERE  id = '<that-uuid>';
```

The dispatcher will pick it up on the next tick (~2 s). If you reset
`attempts = 0`, the full `max_attempts` budget restarts; if you only
reset `available_at`, the row gets one more attempt before going
back to dead. The choice is judgment.

**Do not delete dead rows to "clean up."** They are the audit trail.
Compliance can ask "did this notification ever go out", and `dead`
with `last_error` is a valid answer. An empty row tells them
nothing.

## Dispatcher dyno is down

Symptoms: unprocessed event count climbing without bound,
no `dispatcher run complete` log lines for the last several minutes,
Trigger.dev dashboard shows the schedule run failing or never
starting.

**This is not a data-loss situation.** Events sit in `outbox_event`
forever (the table has no TTL, the dispatcher's the only thing that
sets `processed_at`). The only impact is latency: side-effects don't
fire until the dispatcher comes back.

**Recovery:**

1. Restart the worker dyno (Railway dashboard, or whatever's hosting
   the Trigger.dev runner).
2. Watch `dispatcher run complete` log lines reappear. The first
   tick after restart will drain a large batch (BATCH_SIZE = 50 per
   tick); subsequent ticks catch up over the next minute or two.
3. Confirm the unprocessed count drops back to ~0:
   ```sql
   SELECT count(*) FROM outbox_event WHERE processed_at IS NULL;
   ```
4. Spot-check a couple of recently emitted events (look for ones
   with `created_at > NOW() - INTERVAL '5 minutes'`) — they should
   have `processed_at` set within seconds of the dispatcher coming
   back.

If the dispatcher restarts and the unprocessed count keeps climbing,
something else is wrong (handler stuck, downstream wedged). Switch
to the dead-letter / no_handler triage paths above.

## The success-path-update-throws subtle case

This is the one to commit to memory.

**The dispatcher's atomic unit is one row at a time.** Inside
`processRow`:

```ts
await handler(eventInput)                       // (1) side-effect runs
await tx.outboxEvent.update({ ... processed_at: NOW() ... })  // (2)
```

If step (1) succeeds and step (2) throws (Postgres flickers, the
worker process crashes, the network drops between the dispatcher
and the DB), then on the next dispatcher tick the row is **still
unprocessed** — because `processed_at` never got set — and the
handler runs **again**.

**This is by design.** The alternative (mark processed before running
the handler) would lose side-effects when the handler fails after the
mark, which is much worse. We chose at-least-once over at-most-once.

**The contract this places on every handler:**

- Idempotent. Running twice produces the same outcome as running
  once. No double-charges, no double-emails, no double-stock-decrements.
- The mechanism is `eventId`. Trigger.dev tasks dedupe on
  `idempotencyKey`. Pusher messages carry `eventId` in the body for
  client-side dedupe. Cache `DEL` is naturally idempotent.
  `autoSetLocation` is a pure function of `toStatus`.

If you find yourself debugging a "customer got two emails" report
and trace it to a re-drained outbox event, the answer is **never**
"add a check before running the handler." The answer is "the
downstream isn't honouring `eventId`." Fix the handler.

## Recovering after a Postgres restore

If the team had to restore the production DB from a snapshot (point-in-time
recovery, accidental DROP, etc.), here's what happens to outbox state:

1. **Events created after the restore point are gone.** This is the
   same as any other table. If a customer-facing side-effect
   (notification, broadcast) was lost in the gap, you'll need to
   manually replay or accept the loss.
2. **Events created before the restore point that hadn't been
   processed yet** are restored to their pre-restore state
   (`processed_at = NULL`, `attempts = 0` or whatever they were at
   the snapshot point). When the dispatcher comes back online, it
   picks them up on the next tick and runs the handler. **No special
   action needed.**
3. **Events that were processed before the restore point but the
   side-effect was created after** — e.g. a Resend email that was
   sent post-restore-point but the `processed_at` got rolled back
   — will be re-run. The handler's idempotency (eventId →
   Trigger.dev `idempotencyKey` etc.) is what stops a double-send.
   This is the "success-path-update-throws" case in dramatic costume.

The takeaway: the outbox is **safe under restore** as long as the
handlers honour the eventId contract. You do not need to do anything
special to outbox state after a restore. Bring the DB back up,
restart the dispatcher dyno, watch the unprocessed count drain.

If post-restore you observe a flood of "no_handler" warnings for
event types you don't recognise, those are probably emits from a
deploy that happened after the snapshot but before the restore point
— the producer code is gone, the events are stuck. Mark them
processed manually with `last_error = 'no_handler_post_restore'` if
you want them out of the unprocessed query, or leave them as
forensic evidence.

## When to page someone vs. when to wait

| Symptom                                                          | Action                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Single dead-letter, transient downstream                         | Triage at next-business-day pace.                               |
| Multiple dead-letters in same `event_type` across many aggregates | Page on-call: handler bug, growing blast radius.                |
| Unprocessed count climbing > 100 with no recovery                | Page on-call: dispatcher dead or wedged.                        |
| `no_handler` warnings spiking                                    | Page deploy owner: producer/dispatcher version mismatch.        |
| Single `no_handler` shortly after a deploy                       | Add the missing dispatch entry, ship.                           |
| Slow-dispatch (saturation) under load                            | Note for next capacity review; no immediate action.             |

## If you're modifying the dispatcher

Most readers of this runbook are responding to incidents. This
section is for the rare reader who is opening
`src/trigger/dispatch-outbox.ts` to change something — maybe adding
an observability call, tweaking the backoff math, refactoring the
batch loop. Two non-obvious rules apply, both learned the hard way
during integration testing.

### 1. The dispatcher writes its own outbox UPDATEs via `tx.$executeRaw`. Do not change them to `tx.outboxEvent.update(...)`.

Inside the dispatcher's batch transaction you'll see four UPDATE
calls (one per outcome: no-handler / success / dead / retry).
They're written as raw SQL via `tx.$executeRaw`, not as the typed
`tx.outboxEvent.update(...)` you'd use elsewhere. This looks
inconsistent. It is not a mistake. **Do not "modernise" them.**

The rationale, condensed (full version in ADR 0001 §"Rule 6"):

The append-only guard in `src/lib/prisma.ts` requires an
`AsyncLocalStorage` flag set by `_withAuditWriteAllowed()` in order
to permit a typed-client write to `outbox_event`. The producer-side
helper (`withAuditedTransaction` in `src/lib/audit-outbox.ts`) sets
that flag, runs the business work, and flushes audit + outbox writes
inline at the end of the transaction callback — no intervening
external code, ALS context survives the chain unbroken, the writes
go through.

The dispatcher cannot do this. Between the SELECT FOR UPDATE that
opens its batch and the per-row UPDATE that closes it, the
dispatcher `await`s arbitrary user-registered handler code (Pusher,
Trigger.dev, Redis, downstream HTTP, future libraries, …). Anything
in that code path that disturbs async_hooks context propagation will
leave the AsyncLocalStorage store unset by the time control returns,
and the next typed-client UPDATE then trips the guard at runtime.
**In production this would have wedged the dispatcher the first time
any handler did something ALS-hostile, leaving every retry and
dead-letter UPDATE blocked and outbox events stuck in
`attempts = 0` forever.** The integration tests caught it before it
shipped.

`tx.$executeRaw` bypasses the typed-client surface entirely — the
`$extends` query interceptor never sees these UPDATEs, no ALS check
runs, no flag can be lost. The guard remains in force for everything
else. The dispatcher's escape hatch is sanctioned because the
dispatcher **is** the legitimate writer.

**How the integration tests will catch you if you regress this:**
`tests/integration/dispatcher.integration.test.ts` exercises the
dispatcher end-to-end against real Postgres — including handler
failure paths that go through `handleFailure`. If you change the
dispatcher's UPDATEs back to `tx.outboxEvent.update(...)`, the next
`npm run test:integration` run against the Neon CI branch will fail
with `Direct write to audit_log / outbox_event is forbidden.
(blocked: outbox_event.update)`. That's the runtime guard catching
your refactor. Don't bypass the test by mocking it; revert the
refactor.

### 2. `outbox_event.id` is `TEXT`, not `uuid`. No `::uuid` casts in raw SQL.

The column is declared as `String @id @default(uuid())` in
`prisma/schema.prisma`, which produces UUID-formatted strings stored
in a plain `TEXT` column (Prisma uses TEXT for `String` fields
unless you add `@db.Uuid`). A future contributor writing raw SQL
against this table can be tempted to add `::uuid` casts because the
*values* look like UUIDs:

```sql
-- WRONG — fails with "operator does not exist: text = uuid".
WHERE id = ${row.id}::uuid

-- RIGHT — text-to-text equality, no cast.
WHERE id = ${row.id}
```

The first form was shipped in an early Pass-2 fix and broke on the
Neon staging run with Postgres error code `42883`, followed by
cascading `25P02` "current transaction is aborted" noise on every
subsequent statement. The second form is what's there now.

`tx.$executeRaw` gives up the typed client's compile-time type
safety. **The migration SQL in
`prisma/migrations/…_add_audit_log_and_outbox_event/migration.sql`
is the only authoritative source for column types when you're
writing raw SQL.** Read it before you write the cast.

### Quick checklist before you commit a dispatcher change

- [ ] None of the four `$executeRaw` UPDATEs has been changed to
      `tx.outboxEvent.update(...)`.
- [ ] No new `::uuid` casts on text columns. (Same applies to
      `audit_log.id`, `audit_log.entity_id`, etc. Check the migration
      if unsure.)
- [ ] If you added a new write to `outbox_event` from the
      dispatcher, you used `$executeRaw`. (If you added one from
      anywhere else, you used `withAuditedTransaction` — the
      escape hatch is dispatcher-only.)
- [ ] You ran `npm run test:integration` against the staging Neon
      branch and got 6/6 green.

## Cross-references

- `docs/adr/0001-audit-log-and-outbox.md` — why this exists and the
  rules it enforces. **Read Rule 6 if you're modifying the
  dispatcher.**
- `src/trigger/dispatch-outbox.ts` — the scheduled drainer (read the
  header comment for the exact backoff math, plus the
  "Audit-write guard" block for the typed-client-vs-raw-SQL
  rationale in inline form).
- `src/trigger/outbox-dispatch-table.ts` — the handler registry. Add
  new event types here.
- `src/lib/audit-outbox.ts` — the only sanctioned producer.
- `src/lib/prisma.ts` — the `$extends` guard and the
  `_withAuditWriteAllowed` primitive. Read the "Scope of this guard"
  block before assuming you can use the typed client.
- `tests/integration/dispatcher.integration.test.ts` — the
  end-to-end suite that catches both regressions covered above.
