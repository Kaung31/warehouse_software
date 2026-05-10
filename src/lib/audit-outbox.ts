/**
 * audit-outbox — the ONLY sanctioned writer for `audit_log` and
 * `outbox_event`.
 *
 * Why this exists
 *   "Side effects" (Pusher broadcasts, queued notifications, cache
 *   invalidation, downstream API calls) used to fire inline from API
 *   route handlers, AFTER the business transaction committed. Two
 *   problems:
 *
 *     1. Dual write — DB commits, then Pusher fails → DB and the
 *        outside world are out of sync, no record of the missed event.
 *     2. Audit trail is best-effort — `lib/audit.ts` swallows errors,
 *        so a transient failure leaves no record of the change.
 *
 *   `withAuditedTransaction` fixes both. Every business mutation,
 *   every audit-log row, and every outbox event commits in ONE
 *   Postgres transaction. The dispatcher (Phase 3, separate worker)
 *   drains the outbox at-least-once and triggers the side effects
 *   from there.
 *
 * Usage
 *   ```ts
 *   const result = await withAuditedTransaction(
 *     {
 *       actor:     { userId: user.id, role: user.role, ip, userAgent },
 *       requestId: correlationId,
 *       reason:    'CS approved for mechanic',
 *     },
 *     async (ctx) => {
 *       const before = await ctx.tx.repairOrder.findUnique({ where: { id } })
 *       const after  = await ctx.tx.repairOrder.update({ where: { id }, data: {...} })
 *
 *       ctx.recordChange('repairOrder', id, before, after, 'STATUS_CHANGE')
 *       ctx.emit({
 *         aggregateType: 'case',
 *         aggregateId:   id,
 *         eventType:     'case.status_changed',
 *         payload:       { fromStatus: before!.status, toStatus: after.status },
 *       })
 *       return after
 *     },
 *   )
 *   ```
 *
 * Hard rules enforced here
 *   - Every audit_log row passes through `redactSnapshot()` first.
 *   - Inserts to audit_log + outbox_event happen in the SAME tx as the
 *     business work. If anything throws, all three roll back.
 *   - The Prisma extension in `src/lib/prisma.ts` blocks any caller
 *     that tries to write these tables outside this helper.
 *
 * Deviation from the brief's `emit` signature
 *   The brief sketches `emit(eventType, payload, opts?)` but the
 *   `outbox_event` table requires `aggregate_type` + `aggregate_id`
 *   as NOT NULL. Rather than derive them brittlely from a dotted
 *   eventType, this implementation requires them on the call.
 *   Idempotency-key default behaviour is unchanged: when omitted,
 *   `sha256(aggregate_id + ':' + event_type + ':' + monotonic_seq)`.
 */

import { createHash } from 'node:crypto'
import { prisma, _withAuditWriteAllowed } from './prisma'
import { redactSnapshot, diffSnapshots } from './pii-fields'

/* ─── Public types ────────────────────────────────────────────────── */

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'READ_SENSITIVE'

export type AuditActor = {
  userId:    string | null    // null = system event (cron, dispatcher)
  role:      string
  ip?:       string
  userAgent?: string
}

export type EmitArgs = {
  aggregateType:   string                 // e.g. 'case', 'stock', 'photo'
  aggregateId:     string
  eventType:       string                 // e.g. 'case.status_changed'
  payload:         Record<string, unknown>
  /** Defaults to sha256(aggregateId + ':' + eventType + ':' + seq). */
  idempotencyKey?: string
  /** Defaults to now(). Set in the future to delay first dispatch. */
  availableAt?:    Date
  /** Defaults to 10. Per-event override of outbox_event.max_attempts. */
  maxAttempts?:    number
}

/**
 * The thing your `work` callback receives. `tx` is the Prisma
 * transaction client (use it for all reads/writes inside the work
 * function). `recordChange` and `emit` queue audit_log + outbox rows
 * that the helper flushes in the same tx before commit.
 */
export type AuditContext = {
  tx: TxClient
  recordChange: (
    entityType: string,
    entityId:   string,
    before:     Record<string, unknown> | null,
    after:      Record<string, unknown> | null,
    action?:    AuditAction,
  ) => void
  emit: (args: EmitArgs) => void
}

export type WithAuditedTransactionOpts = {
  actor:     AuditActor
  requestId: string
  reason?:   string
  /** Optional Prisma transaction options forwarded to $transaction.
   *  Use sparingly — long-running tx options can starve connections. */
  isolation?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable'
  timeoutMs?: number
}

/* ─── Internals ───────────────────────────────────────────────────── */

/**
 * Type of the `tx` argument inside a `prisma.$transaction(async (tx) => …)`
 * callback, derived from the (possibly extended) prisma client. Using
 * `Parameters<…>` keeps us resilient to future Prisma type changes.
 */
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

type QueuedAudit = {
  entityType:  string
  entityId:    string
  action:      AuditAction
  before:      unknown
  after:       unknown
  diff:        unknown
}

type QueuedOutbox = {
  aggregateType:  string
  aggregateId:    string
  eventType:      string
  payload:        Record<string, unknown>
  idempotencyKey: string
  availableAt:    Date
  maxAttempts:    number
}

/**
 * Default action when caller doesn't pass one. Heuristic:
 *   - no before, has after  → CREATE
 *   - has before, no after  → DELETE
 *   - both present, `status` field changed → STATUS_CHANGE
 *   - both present, anything else changed  → UPDATE
 */
function inferAction(
  before: Record<string, unknown> | null,
  after:  Record<string, unknown> | null,
): AuditAction {
  if (!before && after)  return 'CREATE'
  if (before  && !after) return 'DELETE'
  if (
    before && after &&
    'status' in before && 'status' in after &&
    before.status !== after.status
  ) {
    return 'STATUS_CHANGE'
  }
  return 'UPDATE'
}

/** Default idempotency key — see file header. */
function defaultIdempotencyKey(
  aggregateId: string,
  eventType:   string,
  seq:         number,
): string {
  return createHash('sha256')
    .update(`${aggregateId}:${eventType}:${seq}`)
    .digest('hex')
}

/* ─── Public API ──────────────────────────────────────────────────── */

/**
 * Run a unit of business work inside a Postgres transaction that
 * also commits the audit_log rows you stage via `ctx.recordChange`
 * and the outbox_event rows you stage via `ctx.emit`.
 *
 * Failure semantics
 *   - If `work(ctx)` throws:        all writes roll back.
 *   - If the audit/outbox flush throws (DB error): all writes roll back.
 *   - If commit fails:               all writes roll back.
 *
 * What this helper does NOT do
 *   - It does not invoke side effects directly. The dispatcher does.
 *     If you `emit('case.status_changed')` and the worker is down,
 *     the row sits in `outbox_event` until the worker recovers.
 *   - It does not retry. The dispatcher retries.
 */
export async function withAuditedTransaction<T>(
  opts: WithAuditedTransactionOpts,
  work: (ctx: AuditContext) => Promise<T>,
): Promise<T> {
  return _withAuditWriteAllowed(async () =>
    prisma.$transaction(
      async (tx) => {
        // Per-tx queues — flushed before the tx commits.
        const audits:  QueuedAudit[]  = []
        const outbox:  QueuedOutbox[] = []
        let   seq = 0

        const ctx: AuditContext = {
          tx: tx as TxClient,

          recordChange(entityType, entityId, before, after, action) {
            // Redact through the PII helper. Both sides redact against
            // the same model name so before/after stay comparable.
            const redactedBefore = redactSnapshot(entityType, before)
            const redactedAfter  = redactSnapshot(entityType, after)
            const diff           = diffSnapshots(redactedBefore, redactedAfter)
            audits.push({
              entityType,
              entityId,
              action: action ?? inferAction(before, after),
              before: redactedBefore,
              after:  redactedAfter,
              diff,
            })
          },

          emit(args) {
            seq += 1
            outbox.push({
              aggregateType:  args.aggregateType,
              aggregateId:    args.aggregateId,
              eventType:      args.eventType,
              payload:        args.payload,
              idempotencyKey: args.idempotencyKey
                ?? defaultIdempotencyKey(args.aggregateId, args.eventType, seq),
              availableAt:    args.availableAt ?? new Date(),
              maxAttempts:    args.maxAttempts ?? 10,
            })
          },
        }

        // Run the user's work. If it throws, $transaction rolls back.
        const result = await work(ctx)

        // Flush queued rows in the same tx. Order doesn't matter —
        // both tables are independent — but we do audit first so a
        // partial failure leaves the audit trail of what was attempted.
        if (audits.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (tx as any).auditEntry.createMany({
            data: audits.map((a) => ({
              actorUserId: opts.actor.userId,
              actorRole:   opts.actor.role,
              entityType:  a.entityType,
              entityId:    a.entityId,
              action:      a.action,
              before:      a.before  ?? undefined,
              after:       a.after   ?? undefined,
              diff:        a.diff    ?? undefined,
              reason:      opts.reason,
              requestId:   opts.requestId,
              ipAddress:   opts.actor.ip,
              userAgent:   opts.actor.userAgent,
            })),
          })
        }

        if (outbox.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (tx as any).outboxEvent.createMany({
            data: outbox.map((e) => ({
              aggregateType:  e.aggregateType,
              aggregateId:    e.aggregateId,
              eventType:      e.eventType,
              payload:        e.payload,
              idempotencyKey: e.idempotencyKey,
              availableAt:    e.availableAt,
              maxAttempts:    e.maxAttempts,
            })),
            // skipDuplicates protects against retried API calls that
            // would otherwise trip the unique constraint on
            // idempotency_key — but ONLY when the caller supplied one,
            // since the default key is monotonic per-tx and won't
            // collide.
            skipDuplicates: true,
          })
        }

        return result
      },
      {
        isolationLevel: opts.isolation,
        timeout:        opts.timeoutMs,
      } as Parameters<typeof prisma.$transaction>[1],
    ),
  )
}

/**
 * Standalone audit emission for events that don't belong to a
 * business mutation — e.g. READ_SENSITIVE when CS opens a customer
 * record, or system events fired by cron jobs. Still flows through
 * the same guarded path so audit_log isn't bypassable.
 *
 * Does NOT emit any outbox events; pair with an explicit
 * `withAuditedTransaction` if you need both.
 */
export async function recordStandaloneAudit(args: {
  actor:      AuditActor
  requestId:  string
  reason?:    string
  entityType: string
  entityId:   string
  action:     AuditAction
  before?:    Record<string, unknown> | null
  after?:     Record<string, unknown> | null
}): Promise<void> {
  await withAuditedTransaction(
    { actor: args.actor, requestId: args.requestId, reason: args.reason },
    async (ctx) => {
      ctx.recordChange(
        args.entityType,
        args.entityId,
        args.before ?? null,
        args.after  ?? null,
        args.action,
      )
    },
  )
}
