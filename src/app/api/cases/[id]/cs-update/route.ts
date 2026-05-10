/**
 * POST /api/cases/[id]/cs-update — pilot of the audit-outbox pattern.
 *
 * Side effects (cache, Pusher, customer notification, warehouse
 * location) used to fire inline after `prisma.$transaction` committed
 * — risking dual-write divergence if any of them failed. They now go
 * via the outbox: this handler emits one event per business outcome,
 * and the dispatcher fans out to handlers in `outbox-dispatch-table.ts`.
 *
 * Events emitted
 *   - `case.status_changed`         — CS approves for mechanic OR
 *                                     marks disputed.
 *   - `case.payment_state_changed`  — payment fields edited without a
 *                                     status transition (cache-bust
 *                                     only, internal).
 *
 * `caseStatusHistory` stays inside the tx — it's the read-side
 * projection that drives StatusTimeline + the recharge-loop's
 * `returnToStatus` lookup, not a duplicate of audit_log.
 */

import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { csUpdateSchema } from '@/lib/schemas/case'
import { prisma } from '@/lib/prisma'
import { withAuditedTransaction } from '@/lib/audit-outbox'

type Ctx = { params: Promise<{ id: string }> }

const ALLOWED = new Set(['AWAITING_INBOUND', 'AWAITING_CS', 'DISPUTED', 'WAITING_FOR_MECHANIC'])

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown, requestId?: string) => {
  const user     = await requireAuth('case:cs_update')
  const { id }   = await (ctx as Ctx).params
  const { data, error } = await parseBody(req, csUpdateSchema)
  if (error) return error

  // Pre-flight read for status validation + invoice id. No row locks.
  const existing = await prisma.repairOrder.findUnique({ where: { id }, include: { invoice: true } })
  if (!existing) return apiError('Case not found', 404)
  if (!ALLOWED.has(existing.status)) {
    return apiError(`Case is in status ${existing.status} — CS cannot update at this stage`, 400)
  }

  // Two mutually exclusive transitions. Approve wins if both are set
  // (matches prior behaviour).
  const transition = data.approveForMechanic
    ? { toStatus: 'WAITING_FOR_MECHANIC' as const, reason: 'CS approved — ready for mechanic',
        broadcastRole: 'MECHANIC' as const, notifyCustomer: true  }
    : data.markDisputed
    ? { toStatus: 'DISPUTED'             as const, reason: 'CS marked as disputed',
        broadcastRole: 'CS'       as const, notifyCustomer: false }
    : null

  await withAuditedTransaction(
    {
      actor: {
        userId:    user.id,
        role:      user.role,
        ip:        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
      requestId: requestId ?? 'cs-update-no-correlation',
      reason:    transition?.reason ?? 'CS payment / notes update',
    },
    async (ax) => {
      // Optional comment.
      if (data.comment) {
        const c = await ax.tx.caseComment.create({
          data: { caseId: id, authorId: user.id, content: data.comment, isCustomerFacing: data.isCustomerFacing },
        })
        ax.recordChange('CaseComment', c.id, null, c)
      }

      // Payment / CS-note edits.
      const paymentPatch: Record<string, unknown> = {}
      if (data.csPaymentNote     !== undefined) paymentPatch.csPaymentNote     = data.csPaymentNote
      if (data.customerPrepaid   !== undefined) paymentPatch.customerPrepaid   = data.customerPrepaid
      if (data.warrantyConfirmed !== undefined) paymentPatch.warrantyConfirmed = data.warrantyConfirmed
      const paymentChanged = Object.keys(paymentPatch).length > 0
      if (paymentChanged) {
        const updated = await ax.tx.repairOrder.update({ where: { id }, data: paymentPatch })
        ax.recordChange('RepairOrder', id,
          { id, csPaymentNote: existing.csPaymentNote, customerPrepaid: existing.customerPrepaid, warrantyConfirmed: existing.warrantyConfirmed },
          { id, csPaymentNote: updated.csPaymentNote,  customerPrepaid: updated.customerPrepaid,  warrantyConfirmed: updated.warrantyConfirmed  },
        )
      }

      // Invoice payment-status edit.
      let invoicePaymentChanged = false
      if (data.paymentStatus && existing.invoice) {
        const before = existing.invoice
        const after  = await ax.tx.invoiceReference.update({
          where: { caseId: id },
          data:  { paymentStatus: data.paymentStatus as 'PAID' | 'UNPAID' | 'DISPUTED' | 'WARRANTY_APPROVED', updatedById: user.id },
        })
        ax.recordChange('InvoiceReference', before.id,
          { id: before.id, paymentStatus: before.paymentStatus },
          { id: after.id,  paymentStatus: after.paymentStatus  },
        )
        invoicePaymentChanged = before.paymentStatus !== after.paymentStatus
      }

      // Status transition + read-side projection + emit.
      if (transition) {
        await ax.tx.repairOrder.update({ where: { id }, data: { status: transition.toStatus } })
        await ax.tx.caseStatusHistory.create({
          data: {
            caseId: id, fromStatus: existing.status, toStatus: transition.toStatus,
            changedById: user.id, reason: transition.reason,
          },
        })
        ax.recordChange('RepairOrder', id, { id, status: existing.status }, { id, status: transition.toStatus })
        ax.emit({
          aggregateType: 'case',
          aggregateId:   id,
          eventType:     'case.status_changed',
          payload:       {
            caseId:         id,
            fromStatus:     existing.status,
            toStatus:       transition.toStatus,
            changedById:    user.id,
            reason:         transition.reason,
            broadcastRole:  transition.broadcastRole,
            notifyCustomer: transition.notifyCustomer,
          },
        })
      } else if (paymentChanged || invoicePaymentChanged) {
        // Internal cache-bust only — no broadcast, no customer comms.
        ax.emit({
          aggregateType: 'case',
          aggregateId:   id,
          eventType:     'case.payment_state_changed',
          payload:       {
            caseId:        id,
            changedFields: {
              csPaymentNote:     data.csPaymentNote,
              customerPrepaid:   data.customerPrepaid,
              warrantyConfirmed: data.warrantyConfirmed,
              paymentStatus:     invoicePaymentChanged ? data.paymentStatus : undefined,
            },
          },
        })
      }
    },
  )

  return apiSuccess({ ok: true })
})
