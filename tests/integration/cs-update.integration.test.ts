import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { prisma } from '@/lib/prisma'
import { resetDb } from './setup'
import { seedCsUpdateFixture } from './_fixtures'

/**
 * cs-update — integration tests against real Postgres.
 *
 * Coverage in this file:
 *   1. Happy path: real audit_log + outbox_event rows appear, the
 *      RepairOrder status moved, the CaseStatusHistory projection was
 *      written. All in one tx.
 *   2. Forced rollback: a Prisma-level error mid-transaction leaves
 *      ZERO rows in audit_log / outbox_event / case_status_history /
 *      case_comment AND the underlying RepairOrder reverts to its
 *      original status.
 *
 * The dispatcher is NOT exercised here — that's `dispatcher.integration.test.ts`.
 * Our route never calls the dispatcher; we only verify the rows
 * land atomically.
 */

beforeEach(resetDb)

/* ─── helpers ─────────────────────────────────────────────────────── */

/**
 * Build a NextRequest the way the cs-update route expects to receive
 * one. We POST JSON; the route's parseBody / withErrorHandler does
 * the rest.
 */
function makeReq(orderId: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/cases/${orderId}/cs-update`, {
    method:  'POST',
    headers: {
      'content-type':       'application/json',
      'x-correlation-id':   `corr-${Date.now()}`,
      'x-forwarded-for':    '203.0.113.7',
      'user-agent':         'integration-test',
    },
    body: JSON.stringify(body),
  })
}

async function callPost(orderId: string, body: Record<string, unknown>) {
  // Import inside the helper so vi.mock() in setup.ts is in effect by
  // the time the route module pulls in prisma / api-helpers.
  const { POST } = await import('@/app/api/cases/[id]/cs-update/route')
  const ctx = { params: Promise.resolve({ id: orderId }) }
  return POST(makeReq(orderId, body), ctx)
}

/* ─── 1. Happy path ───────────────────────────────────────────────── */

describe('POST /api/cases/[id]/cs-update — happy path', () => {
  it('approve-for-mechanic commits audit_log + outbox_event + status history atomically', async () => {
    const f = await seedCsUpdateFixture('AWAITING_CS')

    const res = await callPost(f.repairOrder.id, {
      approveForMechanic: true,
      paymentStatus:      'PAID',
      csPaymentNote:      'Customer paid via card ending 4242',
    })
    expect(res.status).toBe(200)

    /* RepairOrder moved */
    const updated = await prisma.repairOrder.findUniqueOrThrow({ where: { id: f.repairOrder.id } })
    expect(updated.status).toBe('WAITING_FOR_MECHANIC')
    expect(updated.csPaymentNote).toBe('Customer paid via card ending 4242')

    /* CaseStatusHistory projection written */
    const history = await prisma.caseStatusHistory.findMany({ where: { caseId: f.repairOrder.id } })
    expect(history).toHaveLength(1)
    expect(history[0].fromStatus).toBe('AWAITING_CS')
    expect(history[0].toStatus).toBe('WAITING_FOR_MECHANIC')
    expect(history[0].changedById).toBe(f.user.id)

    /* InvoiceReference moved */
    const inv = await prisma.invoiceReference.findUniqueOrThrow({ where: { caseId: f.repairOrder.id } })
    expect(inv.paymentStatus).toBe('PAID')

    /* audit_log: one CREATE-ish row per recordChange call we issued.
     * We don't assert exact count (helper internals may collapse),
     * just the qualitatively-expected entityTypes are present. */
    const audits = await prisma.$queryRaw<Array<{ entity_type: string; action: string; actor_user_id: string | null }>>`
      SELECT entity_type, action, actor_user_id FROM audit_log WHERE entity_id IN (${f.repairOrder.id}, ${f.invoice.id}) OR entity_type = 'CaseComment'
    `
    const types = audits.map(r => r.entity_type)
    expect(types).toContain('RepairOrder')
    expect(types).toContain('InvoiceReference')
    // Every row was actor-tagged with the seeded CS user.
    for (const r of audits) expect(r.actor_user_id).toBe(f.user.id)
    // STATUS_CHANGE inferred for the status row.
    expect(audits.some(r => r.entity_type === 'RepairOrder' && r.action === 'STATUS_CHANGE')).toBe(true)

    /* outbox_event: exactly ONE case.status_changed row */
    const events = await prisma.$queryRaw<Array<{ event_type: string; aggregate_id: string; payload: Record<string, unknown>; processed_at: Date | null }>>`
      SELECT event_type, aggregate_id, payload, processed_at FROM outbox_event WHERE aggregate_id = ${f.repairOrder.id}
    `
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('case.status_changed')
    expect(events[0].processed_at).toBeNull()              // dispatcher hasn't run
    expect(events[0].payload.toStatus).toBe('WAITING_FOR_MECHANIC')
    expect(events[0].payload.notifyCustomer).toBe(true)
    expect(events[0].payload.broadcastRole).toBe('MECHANIC')
  })

  it('payment-only edit emits case.payment_state_changed with no status transition', async () => {
    const f = await seedCsUpdateFixture('AWAITING_CS')

    const res = await callPost(f.repairOrder.id, {
      csPaymentNote: 'Awaiting bank transfer confirmation',
    })
    expect(res.status).toBe(200)

    // Status untouched.
    const updated = await prisma.repairOrder.findUniqueOrThrow({ where: { id: f.repairOrder.id } })
    expect(updated.status).toBe('AWAITING_CS')

    // No status history row.
    const history = await prisma.caseStatusHistory.count({ where: { caseId: f.repairOrder.id } })
    expect(history).toBe(0)

    // One outbox event of the payment_state type.
    const events = await prisma.$queryRaw<Array<{ event_type: string }>>`
      SELECT event_type FROM outbox_event WHERE aggregate_id = ${f.repairOrder.id}
    `
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('case.payment_state_changed')
  })
})

/* ─── 2. Forced rollback ──────────────────────────────────────────── */

describe('POST /api/cases/[id]/cs-update — rollback', () => {
  it('a Prisma error mid-transaction leaves ZERO audit/outbox/history rows AND reverts the RepairOrder', async () => {
    const f = await seedCsUpdateFixture('AWAITING_CS')

    // Inject an error: spy on `prisma.$transaction` itself and
    // decorate the inner `tx` so the next call to
    // `tx.invoiceReference.update` throws.
    //
    // Why not `vi.spyOn(prisma.invoiceReference, 'update')`? Inside
    // a `prisma.$transaction(async (tx) => …)` callback, `tx` is a
    // *separate* transaction client with its own method bindings —
    // the spy on the top-level client never fires. Wrapping the tx
    // is the only place we can intercept the call the route actually
    // makes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const realTx = prisma.$transaction.bind(prisma) as any
    const spy = vi.spyOn(prisma, '$transaction').mockImplementation((
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      arg: any, opts?: any,
    ) => {
      if (typeof arg !== 'function') {
        // Sequential array variant — not used by our handler, defer
        // to the real impl.
        return realTx(arg, opts)
      }
      return realTx(async (tx: Record<string, Record<string, unknown>>) => {
        const original = tx.invoiceReference.update
        tx.invoiceReference.update = (() => {
          throw new Error('forced integration-test failure')
        }) as typeof original
        try {
          return await arg(tx)
        } finally {
          // Postgres will roll back the whole tx anyway, but
          // restoring keeps the tx client a clean object if anything
          // outside re-uses it.
          tx.invoiceReference.update = original
        }
      }, opts)
    })

    try {
      const res = await callPost(f.repairOrder.id, {
        approveForMechanic: true,
        paymentStatus:      'PAID',
      })
      // withErrorHandler turns thrown errors into a 500 — that's the
      // signal the rollback fired.
      expect(res.status).toBe(500)
    } finally {
      spy.mockRestore()
    }

    /* Every table that the failed tx would have touched stayed empty
     * (or untouched). AuditEntry / OutboxEvent are the new models the
     * Prisma client lacks static types for in this sandbox — counts
     * via raw SQL keep the test independent of `prisma generate`. */
    const auditCountRows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`SELECT count(*)::bigint as n FROM audit_log`
    const outboxCountRows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`SELECT count(*)::bigint as n FROM outbox_event`
    const audits  = Number(auditCountRows[0]?.n ?? 0)
    const outbox  = Number(outboxCountRows[0]?.n ?? 0)
    const history = await prisma.caseStatusHistory.count({ where: { caseId: f.repairOrder.id } })
    const comments = await prisma.caseComment.count({ where: { caseId: f.repairOrder.id } })
    expect(audits).toBe(0)
    expect(outbox).toBe(0)
    expect(history).toBe(0)
    expect(comments).toBe(0)

    /* RepairOrder reverted — status still AWAITING_CS, payment fields
     * unchanged. */
    const reloaded = await prisma.repairOrder.findUniqueOrThrow({ where: { id: f.repairOrder.id } })
    expect(reloaded.status).toBe('AWAITING_CS')
    expect(reloaded.csPaymentNote).toBeNull()
  })
})
