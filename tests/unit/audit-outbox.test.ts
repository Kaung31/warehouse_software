import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

/**
 * audit-outbox helper unit tests.
 *
 * Strategy
 *   - Mock `@/lib/prisma` with capture-based fakes so we can assert
 *     exactly what the helper hands to the DB without standing one
 *     up. Real DB behaviour (transaction rollback, unique-constraint
 *     enforcement on idempotency_key) is the job of the Phase 4
 *     integration tests against the Neon CI branch.
 *   - Capture object lives in a `vi.hoisted()` block so the mock
 *     factory can reach it after Vitest's module-graph hoisting.
 */

/* ─── Mock setup (must precede the SUT import) ───────────────────── */

const captured = vi.hoisted(() => ({
  audits:               [] as Record<string, unknown>[],
  outbox:               [] as Record<string, unknown>[],
  transactionCalls:     0,
  withAllowedCalls:     0,
  flagSetDuringFlush:   false,
  // Allow individual tests to inject a thrower.
  workShouldThrow:      false as boolean | string,
  flushShouldThrow:     false as boolean | string,
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    auditEntry: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        if (captured.flushShouldThrow) {
          throw new Error(typeof captured.flushShouldThrow === 'string'
            ? captured.flushShouldThrow : 'flush failed')
        }
        captured.audits.push(...data)
        return { count: data.length }
      }),
    },
    outboxEvent: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        captured.outbox.push(...data)
        return { count: data.length }
      }),
    },
  }

  const prisma = {
    $transaction: vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (cb: any) => {
        captured.transactionCalls++
        return cb(tx)
      },
    ),
    ...tx, // also expose top-level for any caller that needs prisma.foo
  }

  return {
    prisma,
    default:                 prisma,
    _withAuditWriteAllowed:  vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => {
        captured.withAllowedCalls++
        captured.flagSetDuringFlush = true
        try { return await fn() } finally { captured.flagSetDuringFlush = false }
      },
    ),
  }
})

// Import AFTER mock setup.
import {
  withAuditedTransaction,
  recordStandaloneAudit,
} from '@/lib/audit-outbox'

/* ─── Helpers ─────────────────────────────────────────────────────── */

function reset() {
  captured.audits             = []
  captured.outbox             = []
  captured.transactionCalls   = 0
  captured.withAllowedCalls   = 0
  captured.flagSetDuringFlush = false
  captured.workShouldThrow    = false
  captured.flushShouldThrow   = false
}

const baseOpts = {
  actor:     { userId: 'u-1', role: 'CS', ip: '1.2.3.4', userAgent: 'agent' },
  requestId: 'req-abc',
  reason:    'unit-test reason',
}

beforeEach(reset)

/* ─── Happy path ──────────────────────────────────────────────────── */

describe('withAuditedTransaction', () => {
  it('opens exactly one transaction and runs the work callback inside it', async () => {
    const result = await withAuditedTransaction(baseOpts, async (ctx) => {
      // ctx.tx is exposed; sanity-check it's truthy
      expect(ctx.tx).toBeDefined()
      return 42
    })
    expect(result).toBe(42)
    expect(captured.transactionCalls).toBe(1)
    expect(captured.withAllowedCalls).toBe(1)
  })

  it('flushes a recordChange to audit_log within the same tx', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.recordChange(
        'Customer',
        'cust-1',
        { id: 'cust-1', email: 'james@mail.com', city: 'London' },
        { id: 'cust-1', email: 'new@mail.com',   city: 'Manchester' },
      )
    })
    expect(captured.audits).toHaveLength(1)
    const row = captured.audits[0]
    expect(row.entityType).toBe('Customer')
    expect(row.entityId).toBe('cust-1')
    expect(row.actorUserId).toBe('u-1')
    expect(row.actorRole).toBe('CS')
    expect(row.requestId).toBe('req-abc')
    expect(row.reason).toBe('unit-test reason')
    expect(row.ipAddress).toBe('1.2.3.4')
    expect(row.userAgent).toBe('agent')
  })

  it('redacts PII in before / after / diff before insert', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.recordChange(
        'Customer',
        'cust-1',
        { email: 'james@mail.com', name: 'James' },
        { email: 'new@mail.com',   name: 'James' },
      )
    })
    const row = captured.audits[0]
    const before = row.before as Record<string, { __pii?: boolean }>
    const after  = row.after  as Record<string, { __pii?: boolean }>
    expect(before.email.__pii).toBe(true)
    expect(after.email.__pii).toBe(true)
    expect(before.name.__pii).toBe(true)

    const diff = row.diff as Record<string, { before: { __pii?: boolean }; after: { __pii?: boolean } }>
    // email changed → in diff; name unchanged → not in diff
    expect(diff.email).toBeDefined()
    expect(diff.name).toBeUndefined()
    expect(diff.email.before.__pii).toBe(true)
    expect(diff.email.after.__pii).toBe(true)
  })

  it('infers action = STATUS_CHANGE when both sides have a `status` that differs', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.recordChange(
        'RepairOrder',
        'ro-1',
        { id: 'ro-1', status: 'AWAITING_CS' },
        { id: 'ro-1', status: 'WAITING_FOR_MECHANIC' },
      )
    })
    expect(captured.audits[0].action).toBe('STATUS_CHANGE')
  })

  it('infers action = CREATE / UPDATE / DELETE from before/after presence', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.recordChange('Customer', 'cust-create', null, { id: 'cust-create' })
      ctx.recordChange('Customer', 'cust-update', { id: 'x', city: 'A' }, { id: 'x', city: 'B' })
      ctx.recordChange('Customer', 'cust-delete', { id: 'x' }, null)
    })
    expect(captured.audits[0].action).toBe('CREATE')
    expect(captured.audits[1].action).toBe('UPDATE')
    expect(captured.audits[2].action).toBe('DELETE')
  })

  it('honours an explicit action passed by the caller', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.recordChange('Customer', 'cust-1', { id: 'x' }, { id: 'x' }, 'READ_SENSITIVE')
    })
    expect(captured.audits[0].action).toBe('READ_SENSITIVE')
  })

  it('emit() inserts an outbox row with caller-supplied aggregate fields', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.emit({
        aggregateType: 'case',
        aggregateId:   'ro-1',
        eventType:     'case.status_changed',
        payload:       { fromStatus: 'A', toStatus: 'B' },
      })
    })
    expect(captured.outbox).toHaveLength(1)
    const row = captured.outbox[0]
    expect(row.aggregateType).toBe('case')
    expect(row.aggregateId).toBe('ro-1')
    expect(row.eventType).toBe('case.status_changed')
    expect(row.payload).toEqual({ fromStatus: 'A', toStatus: 'B' })
    expect(row.maxAttempts).toBe(10)
    expect(row.availableAt).toBeInstanceOf(Date)
  })

  it('default idempotency key is sha256(aggregateId + ":" + eventType + ":" + seq)', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.emit({ aggregateType: 'case', aggregateId: 'ro-1', eventType: 'case.x', payload: {} })
      ctx.emit({ aggregateType: 'case', aggregateId: 'ro-1', eventType: 'case.x', payload: {} })
    })
    const expected1 = createHash('sha256').update('ro-1:case.x:1').digest('hex')
    const expected2 = createHash('sha256').update('ro-1:case.x:2').digest('hex')
    expect(captured.outbox[0].idempotencyKey).toBe(expected1)
    expect(captured.outbox[1].idempotencyKey).toBe(expected2)
    // Two emits in one tx must produce DIFFERENT default keys so they
    // both land (the unique constraint shouldn't reject them).
    expect(captured.outbox[0].idempotencyKey).not.toBe(captured.outbox[1].idempotencyKey)
  })

  it('honours a caller-supplied idempotency key', async () => {
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.emit({
        aggregateType:  'case',
        aggregateId:    'ro-1',
        eventType:      'case.x',
        payload:        {},
        idempotencyKey: 'custom-key',
      })
    })
    expect(captured.outbox[0].idempotencyKey).toBe('custom-key')
  })

  it('honours availableAt and maxAttempts overrides', async () => {
    const future = new Date(Date.now() + 60_000)
    await withAuditedTransaction(baseOpts, async (ctx) => {
      ctx.emit({
        aggregateType: 'case',
        aggregateId:   'ro-1',
        eventType:     'case.x',
        payload:       {},
        availableAt:   future,
        maxAttempts:   3,
      })
    })
    expect(captured.outbox[0].availableAt).toBe(future)
    expect(captured.outbox[0].maxAttempts).toBe(3)
  })

  it('does NOT call createMany when no audits/outbox were queued', async () => {
    await withAuditedTransaction(baseOpts, async () => {
      // no recordChange, no emit
    })
    expect(captured.audits).toHaveLength(0)
    expect(captured.outbox).toHaveLength(0)
    expect(captured.transactionCalls).toBe(1)
  })

  it('rolls back: when work() throws, neither audit nor outbox rows are inserted', async () => {
    await expect(
      withAuditedTransaction(baseOpts, async (ctx) => {
        ctx.recordChange('Customer', 'cust-1', null, { id: 'cust-1' })
        ctx.emit({ aggregateType: 'case', aggregateId: 'ro-1', eventType: 'x', payload: {} })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(captured.audits).toHaveLength(0)
    expect(captured.outbox).toHaveLength(0)
  })

  it('rolls back: when audit createMany throws, the user error surfaces', async () => {
    captured.flushShouldThrow = 'audit insert failed'
    await expect(
      withAuditedTransaction(baseOpts, async (ctx) => {
        ctx.recordChange('Customer', 'cust-1', null, { id: 'cust-1' })
      }),
    ).rejects.toThrow('audit insert failed')
    // The mocked tx threw before pushing — captured.audits stays empty.
    expect(captured.audits).toHaveLength(0)
  })

  it('runs the entire transaction inside the audit-write-allowed scope', async () => {
    let observed = false
    await withAuditedTransaction(baseOpts, async () => {
      observed = captured.flagSetDuringFlush
    })
    expect(observed).toBe(true)
    expect(captured.flagSetDuringFlush).toBe(false) // cleared after
  })
})

/* ─── recordStandaloneAudit ───────────────────────────────────────── */

describe('recordStandaloneAudit', () => {
  it('writes an audit row and NO outbox event', async () => {
    await recordStandaloneAudit({
      actor:      { userId: 'u-1', role: 'CS' },
      requestId:  'req-1',
      entityType: 'Customer',
      entityId:   'cust-1',
      action:     'READ_SENSITIVE',
      after:      { id: 'cust-1' },
    })
    expect(captured.audits).toHaveLength(1)
    expect(captured.outbox).toHaveLength(0)
    expect(captured.audits[0].action).toBe('READ_SENSITIVE')
  })
})
