/**
 * Outbox dispatcher — drains `outbox_event` and runs the side-effect
 * handlers registered in `outbox-dispatch-table.ts`.
 *
 * Schedule
 *   - Trigger.dev v4 cron is minute-granularity; the project brief
 *     wants ~2 second dispatch latency. So: cron `* * * * *` runs the
 *     task once a minute, and the task itself loops 30 times with a
 *     2 s sleep between batches. Total wall-clock ≈ 60 s; `maxDuration`
 *     90 s leaves room for setup/teardown without overlapping the
 *     next minute.
 *   - Worst-case latency: ~2 s (within a tick). Worst-case after a
 *     restart: ~60 s (cron triggers the next run). Acceptable per the
 *     ADR — the customer-portal tracker is the most latency-sensitive
 *     reader and 60 s is fine for "your scooter has arrived".
 *
 * Concurrency
 *   - Multiple Railway worker dynos may exist. Trigger.dev's
 *     concurrencyKey only deduplicates within one project — for
 *     cross-instance enforcement we use an Upstash distributed lock
 *     (`withLock('outbox-dispatcher', …)`). `maxWaitMs: 0` means a
 *     duplicate cron just no-ops rather than queueing.
 *   - `FOR UPDATE SKIP LOCKED` is belt-and-braces — even if two
 *     dispatchers slip past the Redis lock (Upstash outage, clock
 *     skew, etc.), they won't grab the same rows.
 *
 * Failure semantics
 *   - Per row: handler success → set `processed_at = NOW()`.
 *   - Per row: handler throws → bump `attempts`, set `last_error`,
 *     schedule next retry at `NOW() + min(2^attempts seconds, 600s)`.
 *   - On `attempts >= max_attempts`: leave `processed_at` null
 *     forever (so the row stays visible in queries),
 *     fire Sentry error with the full payload. Operations team uses
 *     the runbook to triage and either fix-and-replay or hand-mark
 *     processed.
 *   - No handler in the table: mark `processed_at` with
 *     `last_error = 'no_handler'`, Sentry-warn once. Don't retry —
 *     a missing handler means a deploy issue, not a transient one.
 *
 * Audit-write guard, and why this file uses `$executeRaw` rather than
 * the typed `tx.outboxEvent.update` (READ THIS BEFORE REFACTORING)
 *   - The Prisma extension in `src/lib/prisma.ts` blocks typed-client
 *     writes to `outbox_event` unless an AsyncLocalStorage flag set
 *     by `_withAuditWriteAllowed` is on the current async context.
 *     `withAuditedTransaction` (the producer-side helper) uses that
 *     flag for its inline `auditEntry.createMany` / `outboxEvent.createMany`
 *     calls, and that works because the flushes happen back-to-back
 *     in the same tx callback with no intervening external code that
 *     could disturb async_hooks state.
 *
 *   - The DISPATCHER's situation is structurally different: between
 *     the SELECT FOR UPDATE that opens each batch and the per-row
 *     UPDATE that closes it, we `await handler(eventInput)` — running
 *     arbitrary user-registered side-effect code (Pusher, Trigger.dev,
 *     Redis, downstream HTTP, future libraries that may use worker
 *     threads, …). Anything in that code path that breaks async_hooks
 *     context propagation will leave the AsyncLocalStorage store
 *     unset by the time control returns to us, and the next
 *     `tx.outboxEvent.update` will then trip the guard at runtime.
 *     The integration tests caught exactly this failure: the
 *     dispatcher would have left every retried / dead-lettered event
 *     stuck in production the first time a handler did something
 *     ALS-hostile.
 *
 *   - The fix: do the dispatcher's own writes via `tx.$executeRaw`,
 *     which goes through the engine without traversing the typed
 *     client surface — the `$extends` query interceptor never sees
 *     these UPDATEs, so there's no ALS check to fail. The guard
 *     remains in force for everything else; this is the dispatcher's
 *     deliberate escape hatch, not a bypass.
 *
 *   - DO NOT replace the `$executeRaw` UPDATEs below with
 *     `tx.outboxEvent.update(...)` "for type safety" — you'll
 *     reintroduce the production bug above. Full rationale in
 *     `docs/adr/0001-audit-log-and-outbox.md` and the
 *     "if you're modifying the dispatcher" section of
 *     `docs/runbook/outbox.md`.
 *
 *   - Type note for the `$executeRaw` blocks: `outbox_event.id` is
 *     **TEXT** in Postgres. Prisma's `String @id @default(uuid())`
 *     emits UUID-formatted strings but the column itself is plain
 *     text — so the WHERE clauses use `id = ${row.id}` (plain text
 *     equality), NOT `id = ${row.id}::uuid` (which would look up a
 *     `text = uuid` operator that doesn't exist). When raw-SQL
 *     editing these tables, check `prisma/schema.prisma` and the
 *     migration in `prisma/migrations/…_add_audit_log_and_outbox_event`
 *     for column types — `$executeRaw` gives up the typed-client's
 *     compile-time type safety, so the migration is the only
 *     authoritative source.
 */

import { logger, schedules } from '@trigger.dev/sdk/v3'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { logger as appLogger } from '@/lib/logger'
import { withLock } from '@/lib/locks'
import {
  dispatchTable,
  NO_HANDLER_MARKER,
  type OutboxEventInput,
} from './outbox-dispatch-table'

/* ─── Logger conventions ──────────────────────────────────────────────
 *
 *   `logger`     — Trigger.dev's per-run logger. Use for run-level
 *                  summaries that should appear in the Trigger.dev
 *                  dashboard alongside the run's status.
 *   `appLogger`  — the project pino logger (src/lib/logger). Use for
 *                  per-row events so they ingest into Better Stack
 *                  with the rest of the app's structured logs and can
 *                  be grep'd by eventId end-to-end across services.
 *
 * Per-row log shape (consistent across success / failure / no-handler):
 *   { eventId, eventType, aggregateType, aggregateId, ... }
 */

/* ─── Tunables ────────────────────────────────────────────────────── */

/** Rows per batch. Limits the duration of the held SELECT FOR UPDATE
 *  transaction. */
const BATCH_SIZE = 50

/** Sleep between batches (ms). 2 s as spec'd. */
const TICK_MS = 2_000

/** Number of ticks per cron-triggered run. 30 × 2 s ≈ 60 s, neatly
 *  matching the cron interval so the lock releases before the next
 *  minute's run. */
const TICKS_PER_RUN = 30

/** Max retry backoff (ms). 10 minutes per spec. */
const MAX_BACKOFF_MS = 10 * 60 * 1000

/** Max attempts before giving up. Project-wide default; can be
 *  overridden per-event via `outbox_event.max_attempts`. */
const DEFAULT_MAX_ATTEMPTS = 10

/* ─── Types for raw SQL result ────────────────────────────────────── */

/** Row shape returned by the SELECT — Postgres column names
 *  (snake_case, since the @@map'd table is `outbox_event`). */
type OutboxRow = {
  id:              string
  aggregate_type:  string
  aggregate_id:    string
  event_type:      string
  payload:         Record<string, unknown>
  attempts:        number
  max_attempts:    number
}

/* ─── The scheduled task ──────────────────────────────────────────── */

export const dispatchOutbox = schedules.task({
  id:          'dispatch-outbox',
  cron:        '* * * * *',     // every minute
  maxDuration: 90,              // wall-clock cap, slightly over the 60 s loop
  run: async (payload, { ctx }) => {
    const startedAt = Date.now()

    // Cross-instance lock. `maxWaitMs: 0` → fail fast on contention so
    // a duplicate cron tick doesn't queue. ttlSeconds slightly above
    // our wall-clock so a crashed dispatcher's lock auto-expires
    // within ~30 s of the next run.
    try {
      const result = await withLock(
        'outbox-dispatcher',
        () => runDispatchLoop({ runId: ctx.run.id }),
        { ttlSeconds: 90, maxWaitMs: 0 },
      )
      logger.info('dispatcher run complete', {
        ...result,
        scheduledAt: payload.timestamp,
        wallMs:      Date.now() - startedAt,
      })
      return result
    } catch (err) {
      if (err instanceof Error && err.message === 'LOCK_BUSY') {
        // Another worker holds the lock — normal during overlap.
        logger.info('dispatcher: lock busy, skipping tick')
        return { skipped: 'lock_busy' as const }
      }
      // Unknown error — let Trigger.dev log + retry per task config.
      throw err
    }
  },
})

/* ─── Loop body ───────────────────────────────────────────────────── */

async function runDispatchLoop(opts: { runId: string }) {
  let totalProcessed = 0
  let totalFailed    = 0
  let totalDead      = 0
  let totalNoHandler = 0
  let totalBatches   = 0
  let totalEmpty     = 0

  logger.debug('dispatcher loop start', { runId: opts.runId })
  for (let i = 0; i < TICKS_PER_RUN; i++) {
    const batch = await dispatchOneBatch()
    totalBatches++
    totalProcessed += batch.processed
    totalFailed    += batch.failed
    totalDead      += batch.dead
    totalNoHandler += batch.noHandler
    if (batch.processed === 0 && batch.failed === 0 && batch.dead === 0 && batch.noHandler === 0) {
      totalEmpty++
    }
    // Sleep BETWEEN batches, not after the last one.
    if (i < TICKS_PER_RUN - 1) await sleep(TICK_MS)
  }

  return {
    processed: totalProcessed,
    failed:    totalFailed,
    dead:      totalDead,
    noHandler: totalNoHandler,
    batches:   totalBatches,
    emptyTicks: totalEmpty,
  }
}

/* ─── One batch (one tx) ──────────────────────────────────────────── */

type BatchResult = {
  processed: number
  failed:    number
  dead:      number
  noHandler: number
}

/**
 * One iteration of the loop: hold a transaction long enough to
 * SELECT-FOR-UPDATE-SKIP-LOCKED a batch, run each handler, UPDATE
 * each row to reflect outcome.
 *
 * The transaction holds for the entire batch — typically <2 s if
 * handlers are fast. If a single handler is slow (say a Pusher
 * timeout), the whole batch is delayed but other workers can still
 * grab a different batch thanks to SKIP LOCKED.
 *
 * No `_withAuditWriteAllowed` wrap: the per-row writes inside this
 * transaction use `$executeRaw`, which bypasses the typed-client
 * guard entirely. See the "Audit-write guard" block at the top of
 * this file for the full rationale.
 */
export async function dispatchOneBatch(): Promise<BatchResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts, max_attempts
      FROM outbox_event
      WHERE processed_at IS NULL
        AND available_at <= NOW()
      ORDER BY available_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `

    const result: BatchResult = { processed: 0, failed: 0, dead: 0, noHandler: 0 }
    for (const row of rows) {
      const outcome = await processRow(tx, row)
      result[outcome]++
    }
    return result
  }, { isolationLevel: 'ReadCommitted' })
}

/* ─── Per-row processing ──────────────────────────────────────────── */

type RowOutcome = 'processed' | 'failed' | 'dead' | 'noHandler'

async function processRow(
  tx:  Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  row: OutboxRow,
): Promise<RowOutcome> {
  const startedAt  = Date.now()
  const eventInput: OutboxEventInput = {
    eventId:       row.id,
    aggregateType: row.aggregate_type,
    aggregateId:   row.aggregate_id,
    eventType:     row.event_type,
    payload:       row.payload,
  }

  const handler = dispatchTable[row.event_type]

  // ── No handler in the registry ──────────────────────────────────
  // Mark processed (don't retry) and Sentry-warn so the deploy gap
  // surfaces as a one-off rather than a retry storm. Phase 4
  // populates the first handler.
  if (!handler) {
    // Raw SQL — see the "Audit-write guard" block at the top of this
    // file. Typed `tx.outboxEvent.update` would trip the guard if any
    // upstream code in the same async chain disturbed ALS state.
    await tx.$executeRaw`
      UPDATE outbox_event
      SET    processed_at = NOW(),
             last_error   = ${NO_HANDLER_MARKER}
      WHERE  id           = ${row.id}
    `
    appLogger.warn(
      {
        eventId:       row.id,
        eventType:     row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId:   row.aggregate_id,
      },
      'outbox: no handler registered',
    )
    Sentry.captureMessage(
      `Outbox: no handler registered for event_type="${row.event_type}"`,
      {
        level: 'warning',
        tags:  { component: 'outbox', event_type: row.event_type },
        extra: { eventId: row.id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id },
      },
    )
    return 'noHandler'
  }

  // ── Run the handler ─────────────────────────────────────────────
  try {
    await handler(eventInput)
    // Raw SQL — see the "Audit-write guard" block at the top of this
    // file. After `await handler(...)` we cannot rely on ALS still
    // being set, so the typed-client write is unsafe here.
    await tx.$executeRaw`
      UPDATE outbox_event
      SET    processed_at = NOW(),
             last_error   = NULL
      WHERE  id           = ${row.id}
    `
    const durationMs = Date.now() - startedAt
    Sentry.addBreadcrumb({
      category: 'outbox',
      level:    'info',
      message:  'row processed',
      data:     {
        eventId:       row.id,
        eventType:     row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId:   row.aggregate_id,
        durationMs,
      },
    })
    appLogger.debug(
      {
        eventId:       row.id,
        eventType:     row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId:   row.aggregate_id,
        durationMs,
      },
      'outbox: row processed',
    )
    return 'processed'
  } catch (err) {
    return handleFailure(tx, row, err)
  }
}

/**
 * Update the row to reflect a failed handler invocation. Either
 * schedule a retry with exponential backoff, or — if we've used all
 * attempts — leave processed_at null and Sentry-alert.
 *
 * Backoff: NOW + min(2^attempts seconds, MAX_BACKOFF_MS).
 *   attempts = 1 → 2 s
 *   attempts = 2 → 4 s
 *   …
 *   attempts = 9 → 512 s
 *   any higher → 600 s cap
 *
 * Note: `attempts` is the post-increment value (the count of attempts
 * we've now made including this one), so backoff applies after the
 * first failure (attempts=1 → 2 s before retry).
 */
async function handleFailure(
  tx:  Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  row: OutboxRow,
  err: unknown,
): Promise<RowOutcome> {
  const attempts     = row.attempts + 1
  const errorMessage = err instanceof Error
    ? err.message.slice(0, 1024)
    : String(err).slice(0, 1024)

  const isDead = attempts >= row.max_attempts

  if (isDead) {
    // Raw SQL — see the "Audit-write guard" block at the top of this
    // file. We deliberately do NOT set processed_at (row stays
    // visible to ops queries forever as evidence) and do NOT advance
    // available_at (pointless, we won't retry).
    await tx.$executeRaw`
      UPDATE outbox_event
      SET    attempts   = ${attempts},
             last_error = ${errorMessage}
      WHERE  id         = ${row.id}
    `
    appLogger.error(
      {
        eventId:       row.id,
        eventType:     row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId:   row.aggregate_id,
        attempts,
        maxAttempts:   row.max_attempts,
        errorMessage,
      },
      'outbox: dead letter',
    )
    Sentry.captureException(err instanceof Error ? err : new Error(errorMessage), {
      level: 'error',
      tags:  {
        component:    'outbox',
        outbox_state: 'dead',
        event_type:   row.event_type,
      },
      extra: {
        eventId:       row.id,
        aggregateType: row.aggregate_type,
        aggregateId:   row.aggregate_id,
        attempts,
        maxAttempts:   row.max_attempts,
        payload:       row.payload,
      },
    })
    return 'dead'
  }

  // Still has retries left.
  const backoffMs = Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS)
  // Raw SQL — see the "Audit-write guard" block at the top of this
  // file.
  await tx.$executeRaw`
    UPDATE outbox_event
    SET    attempts     = ${attempts},
           last_error   = ${errorMessage},
           available_at = ${new Date(Date.now() + backoffMs)}
    WHERE  id           = ${row.id}
  `
  appLogger.warn(
    {
      eventId:       row.id,
      eventType:     row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId:   row.aggregate_id,
      attempts,
      maxAttempts:   row.max_attempts,
      backoffMs,
      errorMessage,
    },
    'outbox: handler failed — retry scheduled',
  )
  return 'failed'
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/* ─── Test exports ───────────────────────────────────────────────────
 *
 * Pass 2 unit tests need to exercise backoff math + the per-row outcome
 * decision tree without spinning up a real Postgres or hitting
 * Trigger.dev's runtime. We export the pure-ish helpers behind an
 * underscore so it's clear they're internal. */
export const _internal = {
  BATCH_SIZE,
  TICK_MS,
  TICKS_PER_RUN,
  MAX_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  /** Compute next available_at backoff for a given (post-increment)
   *  attempts count. Exposed for unit tests. */
  computeBackoffMs(attempts: number): number {
    return Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS)
  },
  /** True when a row should be considered dead-letter after this
   *  failure. */
  shouldGiveUp(attemptsAfter: number, maxAttempts: number): boolean {
    return attemptsAfter >= maxAttempts
  },
  dispatchOneBatch,
  processRow,
  handleFailure,
}
