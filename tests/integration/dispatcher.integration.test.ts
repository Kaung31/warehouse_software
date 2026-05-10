import { describe, it, expect, beforeEach, vi } from 'vitest'

import { prisma } from '@/lib/prisma'
import { resetDb, pusherCaptured, triggerCaptured, cacheCaptured } from './setup'
import { seedCsUpdateFixture } from './_fixtures'
import { dispatchTable } from '@/trigger/outbox-dispatch-table'
import { _internal as dispatcher } from '@/trigger/dispatch-outbox'

/**
 * Outbox dispatcher — integration tests against real Postgres + the
 * real handlers registered in outbox-dispatch-table.ts. External
 * services (Pusher, tasks.trigger, Redis cache) are stubbed in
 * setup.ts so we can count calls.
 *
 * Coverage in this file:
 *   3. Idempotency on second drain — same outbox row processed twice
 *      should fan out exactly once. processed_at gates the second pass.
 *   4. Dead-letter visibility — handler that always throws gets
 *      retried up to max_attempts, then the row stays processed_at
 *      = null (visible to ops queries) with last_error populated.
 *   5. Cache invalidation called exactly once per case_status_changed
 *      drain, even if the handler emits multiple downstream side
 *      effects.
 */

beforeEach(resetDb)

/* ─── helpers ─────────────────────────────────────────────────────── */

/**
 * Insert one outbox row referencing the seeded RepairOrder.
 *
 * IMPLEMENTATION NOTE — why raw SQL, not the typed Prisma client:
 *
 *   The earlier version used
 *
 *     _withAuditWriteAllowed(async () => client.outboxEvent.create({...}))
 *
 *   under the assumption that wrapping the call in an async closure
 *   would keep the audit-write-allowed AsyncLocalStorage scope active
 *   through the await chain. It doesn't. Prisma's `$extends` query
 *   interceptor runs at the library-engine boundary in a context
 *   that doesn't preserve async_hooks state, so by the time the
 *   guard inside the interceptor calls `auditWriteAllowed.getStore()`,
 *   the store reads as undefined and the guard rightly throws
 *   "Direct write to audit_log / outbox_event is forbidden."
 *
 *   Raw SQL bypasses this entirely. The guard only intercepts the
 *   typed client surface (`prisma.<model>.<op>`). `$executeRaw` /
 *   `$queryRaw` go straight to the engine without traversing the
 *   `$allOperations` callback, so no bypass is needed and no ALS
 *   has to survive.
 *
 *   This is the same approach `setup.ts` uses for TRUNCATE — keeping
 *   raw SQL as the test-fixture escape hatch is a deliberate pattern,
 *   not a workaround. The production guard is unchanged and remains
 *   the only thing protecting the typed-client surface.
 */
async function insertStatusChangedEvent(
  caseId: string,
  user:   { id: string },
  overrides?: Partial<{ idempotencyKey: string; maxAttempts: number; eventType: string }>,
): Promise<{ id: string }> {
  const eventType      = overrides?.eventType      ?? 'case.status_changed'
  const idempotencyKey = overrides?.idempotencyKey ?? `it-${Date.now()}-${Math.random()}`
  const maxAttempts    = overrides?.maxAttempts    ?? 10
  const payload = {
    caseId,
    fromStatus:     'AWAITING_CS',
    toStatus:       'WAITING_FOR_MECHANIC',
    changedById:    user.id,
    reason:         'integration test',
    broadcastRole:  'MECHANIC',
    notifyCustomer: true,
  }

  // Raw INSERT … RETURNING. `gen_random_uuid()` lives in pgcrypto,
  // which Neon enables by default. The payload is interpolated as a
  // JSON string and cast to jsonb at the database side.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO outbox_event
      (id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, max_attempts)
    VALUES
      (gen_random_uuid(), 'case', ${caseId}, ${eventType},
       ${JSON.stringify(payload)}::jsonb, ${idempotencyKey}, ${maxAttempts})
    RETURNING id
  `
  return { id: rows[0].id }
}

/* ─── 3. Idempotency on second drain ──────────────────────────────── */

describe('dispatcher — idempotency on second drain', () => {
  it('processes a row exactly once across two dispatchOneBatch passes', async () => {
    const f = await seedCsUpdateFixture('AWAITING_CS')
    const evt = await insertStatusChangedEvent(f.repairOrder.id, f.user)

    /* First drain — fans out to all stubs. */
    const r1 = await dispatcher.dispatchOneBatch()
    expect(r1.processed).toBe(1)
    expect(pusherCaptured).toHaveLength(1)
    expect(triggerCaptured).toHaveLength(1)
    // Same eventId used as the Trigger.dev idempotencyKey
    expect(triggerCaptured[0].opts?.idempotencyKey).toBe(evt.id)

    /* Row marked processed in DB. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after1 = await (prisma as any).outboxEvent.findUniqueOrThrow({ where: { id: evt.id } })
    expect(after1.processedAt).not.toBeNull()
    expect(after1.lastError).toBeNull()

    /* Second drain — must be a no-op for this row. */
    const r2 = await dispatcher.dispatchOneBatch()
    expect(r2.processed).toBe(0)
    // Stubs were not called a second time.
    expect(pusherCaptured).toHaveLength(1)
    expect(triggerCaptured).toHaveLength(1)
  })
})

/* ─── 4. Dead-letter visibility ───────────────────────────────────── */

describe('dispatcher — dead letter after max_attempts', () => {
  it('a handler that always throws ends up at processed_at=null, attempts=max, last_error set', async () => {
    const f = await seedCsUpdateFixture('AWAITING_CS')

    // Override the registered handler for this test only with one
    // that always throws. afterEach restores so other tests still see
    // the real handler (we use a `try/finally` here for explicitness).
    const realHandler = dispatchTable['case.status_changed']
    const failure    = new Error('integration: handler always fails')
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw failure })

    try {
      const evt = await insertStatusChangedEvent(f.repairOrder.id, f.user, { maxAttempts: 3 })

      // Three attempts: each call retries because available_at is in
      // the past after the previous failure → wait? Actually we'd have
      // to wait for backoff. Instead, after each failed attempt we
      // poke available_at back to NOW so the next dispatchOneBatch
      // picks the row up immediately. (In production the dispatcher
      // sleeps; in the test we accelerate.)
      for (let i = 0; i < 3; i++) {
        await dispatcher.dispatchOneBatch()
        // Raw SQL for the same reason as the seeder: typed-client
        // writes can't reach the audit-write-allowed scope through
        // Prisma's engine boundary. `$executeRaw` is the test
        // fixture's escape hatch.
        await prisma.$executeRaw`
          UPDATE outbox_event
          SET    available_at = NOW() - INTERVAL '1 hour'
          WHERE  id = ${evt.id}
        `
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalRow = await (prisma as any).outboxEvent.findUniqueOrThrow({ where: { id: evt.id } })
      expect(finalRow.processedAt).toBeNull()              // visible to ops queries
      expect(finalRow.attempts).toBe(3)                    // hit max
      expect(finalRow.lastError).toMatch(/always fails/)
    } finally {
      // Restore the real handler.
      dispatchTable['case.status_changed'] = realHandler
    }
  })
})

/* ─── 5. Cache invalidation called exactly once per drain ─────────── */

describe('dispatcher — cache invalidation cardinality', () => {
  it('invalidateCaseCache fires exactly once per case.status_changed event drained', async () => {
    const f = await seedCsUpdateFixture('AWAITING_CS')

    // Insert two distinct events for the same case (different
    // idempotency keys). Both should drain in one batch.
    await insertStatusChangedEvent(f.repairOrder.id, f.user, { idempotencyKey: 'it-cache-1' })
    await insertStatusChangedEvent(f.repairOrder.id, f.user, { idempotencyKey: 'it-cache-2' })

    const result = await dispatcher.dispatchOneBatch()
    expect(result.processed).toBe(2)
    // One invalidate per event.
    expect(cacheCaptured.invalidatedCaseIds).toHaveLength(2)
    expect(cacheCaptured.invalidatedCaseIds.every(id => id === f.repairOrder.id)).toBe(true)

    // Pusher: same — one broadcast per event (each event represents
    // a real status transition, even if both happen to be the same
    // toStatus in this test).
    expect(pusherCaptured).toHaveLength(2)
  })
})
