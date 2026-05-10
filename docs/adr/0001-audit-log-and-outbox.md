# ADR 0001 — Audit log and transactional outbox

- **Status:** Accepted (May 2026, pilot migration of `cs-update`).
- **Decision-makers:** ScooterHub backend.
- **Affected surface:** every API route that mutates business state.

## Audience

You're reading this because you're either:

1. About to migrate another handler to the audit-outbox pattern, and
   you want to know the rules.
2. Trying to understand why the cs-update endpoint is structured the
   way it is.
3. Joining the team and someone said "read this before you touch any
   case-status route."

In all three cases, this document is self-contained. You don't need to
have been around for the migration. You don't need to know which
sprint we did it in.

## Context — the problem we solved

Every case-status-change endpoint in this codebase used to look like
this:

```ts
await prisma.$transaction(async (tx) => {
  await tx.repairOrder.update({ ... })
  await tx.caseStatusHistory.create({ ... })
})
// transaction has now COMMITTED.

await logAudit({ ... })            // best-effort, swallows errors
await invalidateCaseCache(id)      // network call to Redis
await broadcastCaseUpdate({ ... }) // network call to Pusher
await enqueue('notify-...', ...)   // network call to Trigger.dev
await autoSetLocation(id, status)  // separate prisma write
```

Five network-bound calls fire **after** the database commits. Each one
can fail independently. When any of them fail, the database has
already moved on, and the outside world is now permanently out of sync
with what we believe to be true.

Concretely, we observed three failure modes in production logs over a
six-month window:

1. **The audit row never landed.** `logAudit()` swallows errors. A
   transient Postgres blip would leave us with a status change in the
   business tables and no record of who did it. Compliance asks "who
   approved this case for mechanic last Tuesday?" — and the answer is
   sometimes "we don't know."

2. **The customer email never sent.** `enqueue()` fired, the API
   responded 200, the case went to the mechanic queue, but the
   customer never got the "your scooter is being worked on" email.
   The case was real, the side-effect was lost.

3. **Pusher fan-out raced cache invalidation.** A subscriber received
   the realtime update, immediately re-read the cache, and got the
   pre-change snapshot back. Confusing UI bugs that only reproduced
   under load.

All three are instances of the **dual-write problem**: a database
commit and an external side-effect cannot be made atomic by chaining
them in application code. One will fire and the other won't, and you
won't know which.

## Decision

We solve dual-write the standard way: **transactional outbox**.

1. Every mutating endpoint runs inside `withAuditedTransaction(opts, work)`,
   which opens **one** Postgres transaction and commits three things
   atomically:
   - the business mutations themselves (RepairOrder, InvoiceReference,
     etc.),
   - one row in `audit_log` per `recordChange()` call inside the work,
   - one row in `outbox_event` per `emit()` call inside the work.

   If anything throws, all three roll back. There is no in-between
   state.

2. Side-effects (Pusher, Trigger.dev tasks, cache invalidation,
   warehouse-location updates) move **out** of the API endpoint and
   into handlers in `src/trigger/outbox-dispatch-table.ts`, keyed by
   `event_type`.

3. A scheduled background task (`src/trigger/dispatch-outbox.ts`)
   drains `outbox_event` once a minute, polls in 2-second ticks within
   that minute (so worst-case latency from emit to handler ≈ 2s), and
   invokes the registered handler for each row. On success it sets
   `processed_at`. On failure it bumps `attempts`, schedules a backoff
   retry, and after `max_attempts` it leaves the row visible to ops
   queries forever (dead letter).

4. Every handler is **idempotent**, gated by the `eventId` (the
   outbox row's UUID). A re-drained event is a no-op at every
   downstream side-effect that supports an idempotency key
   (Trigger.dev SDK; Pusher message body for client-side dedupe;
   cache `DEL` is naturally idempotent; `autoSetLocation` is a pure
   function of `toStatus`).

## Architecture rules (non-negotiable)

These are the hard rules. They exist because the foundation only
works if every handler honours them.

### Rule 1 — `audit_log` is the source of truth

`audit_log` records **every** field-level change to a business row,
with PII redacted to `{ __pii: true, hash: <sha256-hex>, len: <int> }`
shape via the `redactSnapshot()` helper. It's append-only — the
Prisma extension in `src/lib/prisma.ts` blocks update / delete
operations against this table outside the audit-write-allowed scope.

When compliance, support, or a customer asks "what did this row look
like at 14:32 on Tuesday and who changed it?", the answer comes from
`audit_log`. Not from `case_status_history`. Not from application
logs. Not from Sentry breadcrumbs.

### Rule 2 — `case_status_history` is a read-side projection

`case_status_history` exists for two specific UI / business reasons,
both of them read-side:

1. The StatusTimeline component renders a case's transitions for
   support and CS staff to read at a glance.
2. The recharge-loop's `returnToStatus` lookup needs the previous
   status so a "returned from recharge" transition can put the case
   back where it came from.

It is **not** a duplicate of `audit_log`. It contains a subset of
information (status transitions only — no payment-field edits, no
comment additions, no PII), and it's queried by application code, not
by compliance or auditors.

**Hard rule for new handlers:** writes to `case_status_history` must
happen **inside** `withAuditedTransaction`'s callback, on the
transaction client (`ax.tx.caseStatusHistory.create(...)`). They
commit atomically with the audit + outbox writes. If a handler writes
the projection outside the transaction, the projection can drift from
the truth in `audit_log` — which is the failure mode we're paying for
this whole pattern to prevent.

### Rule 3 — line growth is the cost of audit fidelity

A migrated handler is typically **30–50 % longer** than its
pre-migration equivalent. We considered this and accepted it. The
reasoning:

The growth comes almost entirely from explicit `recordChange()` calls
with before/after snapshots, one per logical mutation. Collapsing
multiple mutations into one omnibus snapshot would shrink the handler
but **destroy `audit_log` query precision**: instead of "show me every
row where `paymentStatus` changed", you'd be reduced to "show me every
row where any of the payment fields changed", with no way to recover
which one.

The audit_log query precision is the foundation's **most valuable
property**. Every other benefit (atomicity, dispatcher retries, dead
letters) follows from "the database knows what happened." Sacrificing
that to save 30 lines per handler is a bad trade.

**"Shorter and clearer" is a shape heuristic, not a line-count one.**
A migrated handler is clearer because:

- every mutation is visible (`recordChange()` next to the write),
- every event is declared (`emit()` with an explicit payload),
- there's no fire-and-forget tail of side-effects after commit.

If you're migrating a new handler and find yourself trying to shrink
it by collapsing snapshots, stop. The line count is correct; resist
the temptation to over-optimise. If the shape is wrong (you're
mixing imperative side-effects with declarative emits, or you're
emitting from outside the work callback), that's the real problem.

### Rule 4 — `notifyCustomer` is the canonical handler-driven gating pattern

When a side-effect should fire on **some** transitions but not others,
encode the decision as a boolean in the event payload at emit time.
The dispatch handler routes based on the boolean. Don't reverse-engineer
the decision from `toStatus` inside the handler.

Concrete example from `cs-update`:

```ts
// PRODUCER (cs-update) — knows the policy, stamps the boolean.
ax.emit({
  eventType: 'case.status_changed',
  payload: {
    ...,
    notifyCustomer: data.approveForMechanic,  // true on approve, false on dispute
  },
})

// DISPATCH HANDLER — dumb router, no policy knowledge.
'case.status_changed': async (event) => {
  const p = caseStatusChangedPayload.parse(event.payload)
  ...
  if (p.notifyCustomer) {
    await tasks.trigger('notify-status-change', ..., { idempotencyKey: event.eventId })
  }
}

// NOTIFICATION TASK — picks template content from toStatus.
notifyStatusChange({ caseId, toStatus })
  → triggerEventForStatus(toStatus)  // template lookup
```

Three layers, three jobs:

1. **Producer** decides the policy ("disputes are internal, so don't
   notify"). The policy lives next to the business rules that
   generated it.
2. **Dispatch handler** routes based on the payload bool. It doesn't
   need to know about disputes; it doesn't need to be updated when CS
   adds a fourth transition tomorrow.
3. **Notification task** decides content (template, subject, channel)
   from `toStatus`. The dispatch handler doesn't care about template
   logic.

Future migrations should follow this pattern. If you find yourself
writing `if (toStatus === 'X' || toStatus === 'Y') tasks.trigger(...)`
inside a dispatch handler, you're putting policy in the wrong layer
— hoist it back to the producer as a payload boolean.

### Rule 5 — `eventId` is the universal idempotency key

The dispatcher is **at-least-once**. If the worker crashes between
"handler returned successfully" and "UPDATE outbox_event SET
processed_at = NOW()", the row is re-drained on the next tick. Your
handler will run twice. Without idempotency, that means two emails,
two pushes, two stock decrements.

Every dispatch handler **must** pass `event.eventId` (the UUID of the
outbox row) to every downstream side-effect that supports an
idempotency key:

| Side-effect              | Pass eventId as                          |
| ------------------------ | ---------------------------------------- |
| `tasks.trigger(...)`     | `{ idempotencyKey: event.eventId }`      |
| `broadcastCaseUpdate()`  | `payload: { eventId: event.eventId }`    |
|                          | (Pusher has no server-side dedupe;       |
|                          | clients dedupe on the body field.)       |
| `invalidateCaseCache()`  | not needed — `DEL` is naturally          |
|                          | idempotent. `eventId` is still used in   |
|                          | log lines for trace correlation.         |
| `autoSetLocation()`      | not needed — sets the row to a pure      |
|                          | function of `toStatus`. Re-running is a  |
|                          | no-op.                                   |

This is the contract. A handler that doesn't honour it is a bug.

### Rule 6 — the dispatcher writes its own outbox UPDATEs via `$executeRaw`

The append-only guard in `src/lib/prisma.ts` reads an
`AsyncLocalStorage` flag set by `_withAuditWriteAllowed()`. Producer-side
writes through `withAuditedTransaction()` work because the typed
`auditEntry.createMany` / `outboxEvent.createMany` calls fire
**inline** inside one transaction callback with no intervening
external code — the ALS context survives the chain unbroken, the
guard sees the flag, and the writes go through.

The dispatcher's situation is structurally different. Inside its
batch transaction, between the SELECT FOR UPDATE that picks up rows
and the per-row UPDATE that records the outcome, the dispatcher
`await`s arbitrary user-registered handler code (Pusher, Trigger.dev,
Redis, downstream HTTP, future libraries that may use worker threads,
etc.). **Any code path in those handlers that disturbs async_hooks
context propagation will leave the AsyncLocalStorage store unset by
the time control returns** — and the next typed-client write to
`outbox_event` then trips the guard at runtime, leaving every retry
and dead-letter UPDATE blocked. The integration tests caught exactly
this: in production, the dispatcher would have wedged the first time
any handler did something ALS-hostile, leaving outbox events stuck in
`attempts = 0` forever.

The fix: the dispatcher does its own writes via `tx.$executeRaw`,
which goes straight to the engine without traversing the typed-client
surface. The `$extends` query interceptor never sees these UPDATEs —
no ALS check, no flag to lose, no fragility. The guard remains in
force for every other write. **This is the dispatcher's deliberate
escape hatch, not a bypass.**

**DO NOT undo this:**

- Do not "modernise" the four `$executeRaw` UPDATEs in
  `src/trigger/dispatch-outbox.ts` to `tx.outboxEvent.update(...)`
  for type safety, prettier syntax, or anything else. You will
  reintroduce the production bug above. The integration tests
  (`tests/integration/dispatcher.integration.test.ts`) will catch
  the regression — but only after you've discovered it the hard way.
- Do not generalise the escape hatch. **Any other code reaching
  for `$executeRaw` to write `audit_log` / `outbox_event` is a
  code-review red flag.** The producer side has the helper for a
  reason; using `$executeRaw` outside the dispatcher gives up the
  guarantees the helper provides (PII redaction, idempotency-key
  defaults, atomic flush with the business mutation).

The dispatcher's escape hatch is sanctioned because the dispatcher
**is** the legitimate writer — the guard exists to catch *foreign*
code accidentally writing these tables, not to gate the dispatcher
itself. Forcing it through ALS adds fragility for zero defence-in-depth
gain.

### Rule 7 — `outbox_event.id` is TEXT, not UUID

Prisma's `String @id @default(uuid())` emits UUID-formatted strings
but the column type is plain `TEXT` (the default for Prisma `String`
fields without an explicit `@db.Uuid` annotation). Migrating
contributors must read this carefully, because raw-SQL access to the
table loses the typed client's compile-time type guarantee.

The trap: writing `WHERE id = ${row.id}::uuid` in a `$executeRaw`
template looks correct (the value *is* a UUID-formatted string!) but
fails at runtime with `operator does not exist: text = uuid` —
Postgres looks for a `text = uuid` operator in the system catalog,
finds none, and aborts the statement (followed by `current transaction
is aborted` noise on every subsequent statement in the same tx).

The right form: `WHERE id = ${row.id}` — plain text-to-text
equality. Prisma parameterises the bind value as text; Postgres
compares text to text; no cast needed.

When raw-SQL editing `audit_log` / `outbox_event` (or any of the
project's other String-typed id columns), check
`prisma/schema.prisma` and the relevant migration in
`prisma/migrations/…` for the column's actual type. **`$executeRaw`
gives up the typed client's compile-time safety, so the migration
SQL is the only authoritative source.**

## What this is NOT for

The audit-outbox pattern is the right tool for "mutate business state
+ fan out side-effects atomically." It is the **wrong** tool for:

### Not a user-facing activity feed

If product wants a "recent activity" feed for case timelines or user
profiles, **do not query `audit_log` directly**. The redacted PII
shape is for compliance, not display; the entity-snapshot format is
optimised for diffing, not for reading. Build a dedicated projection
table (similar in spirit to `case_status_history`) populated from a
dispatch handler subscribed to the relevant `event_type`s.

### Not full event sourcing

We persist events for the **side-effect dispatch** machinery, not as
the system of record for business state. The system of record is still
the normalised business tables (`RepairOrder`, `Customer`, etc.). We
do not rebuild current state by replaying events. If you need that
guarantee — e.g. for financial reconciliation — talk to the team
before assuming the outbox provides it. It probably does not, because
not every state-changing path emits an event yet (only migrated
handlers do).

### Not eventual-consistency-tolerant for everything

Typical end-to-end latency from emit to side-effect is **~2 seconds**
under normal load (the dispatcher's tick interval). Under retry
backoff it can stretch to **~10 minutes** (the cap on exponential
backoff). For most side-effects this is fine. For anything where the
user expects synchronous feedback within the same request — payment
authorisation, real-time reservation — keep the call inline and
accept the dual-write risk explicitly. The audit-outbox pattern
trades synchronicity for atomicity; if you need synchronicity, don't
use this pattern.

## Options considered

### Option A — keep inline writes (pre-migration state)

Five network calls after commit, no atomicity guarantee. Has the
dual-write bug. **Rejected** because we observed all three failure
modes (lost audit rows, lost notifications, cache races) in production.

### Option B — full event sourcing

Make events the system of record. Rebuild current state by replay.
Every mutation is an event; the business tables are projections.

**Rejected** for two reasons:

1. **Operational cost.** Event-sourced systems require event versioning,
   schema evolution discipline, projection rebuild tooling, and a
   mental model that's foreign to most of the team. ScooterHub runs
   one warehouse with a small backend team. The complexity-per-feature
   ratio doesn't justify it.
2. **No incremental migration path.** Going to event sourcing means
   rewriting every handler at once — there's no "migrate one
   endpoint" intermediate state, because the business tables stop
   being the source of truth.

### Option C — transactional outbox (chosen)

Hybrid: business tables remain the source of truth; events exist
specifically to drive side-effect dispatch with at-least-once
delivery and atomic commit. Migration is incremental, one handler at
a time. Adding a new event type is a one-line change in the dispatch
table.

**Chosen** because it eliminates the dual-write bug we actually have
without taking on the event-sourcing operational tax we don't need.

## Cross-references

- `src/lib/audit-outbox.ts` — the only sanctioned writer for both
  tables. If you're writing to `audit_log` or `outbox_event` directly,
  you're doing it wrong.
- `src/lib/prisma.ts` — Prisma `$extends` guard that enforces "only
  the helper writes."
- `src/lib/pii-fields.ts` — the PII inventory + `redactSnapshot()`.
- `src/trigger/dispatch-outbox.ts` — the scheduled drainer.
- `src/trigger/outbox-dispatch-table.ts` — the registry.
- `docs/runbook/outbox.md` — operational playbook for triage,
  manual replay, and recovery.
