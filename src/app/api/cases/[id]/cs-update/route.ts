import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { csUpdateSchema } from '@/lib/schemas/case'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:cs_update')
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, csUpdateSchema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({
    where: { id },
    include: { invoice: true },
  })
  if (!existing) return apiError('Case not found', 404)

  if (!['AWAITING_INBOUND', 'AWAITING_CS', 'DISPUTED', 'WAITING_FOR_MECHANIC'].includes(existing.status)) {
    return apiError(`Case is in status ${existing.status} — CS cannot update at this stage`, 400)
  }

  await prisma.$transaction(async (tx) => {
    // Add comment if provided
    if (data.comment) {
      await tx.caseComment.create({
        data: {
          caseId:          id,
          authorId:        user.id,
          content:         data.comment,
          isCustomerFacing: data.isCustomerFacing,
        },
      })
    }

    // Update payment status if changed
    if (data.paymentStatus) {
      if (existing.invoice) {
        await tx.invoiceReference.update({
          where: { caseId: id },
          data:  { paymentStatus: data.paymentStatus as 'PAID' | 'UNPAID' | 'DISPUTED' | 'WARRANTY_APPROVED', updatedById: user.id },
        })
      }
    }

    // Handle status transitions
    if (data.approveForMechanic) {
      await tx.repairOrder.update({ where: { id }, data: { status: 'WAITING_FOR_MECHANIC' } })
      await tx.caseStatusHistory.create({
        data: {
          caseId:      id,
          fromStatus:  existing.status,
          toStatus:    'WAITING_FOR_MECHANIC',
          changedById: user.id,
          reason:      'CS approved — ready for mechanic',
        },
      })
    } else if (data.markDisputed) {
      await tx.repairOrder.update({ where: { id }, data: { status: 'DISPUTED' } })
      await tx.caseStatusHistory.create({
        data: {
          caseId:      id,
          fromStatus:  existing.status,
          toStatus:    'DISPUTED',
          changedById: user.id,
          reason:      'CS marked as disputed',
        },
      })
    }
  })

  await logAudit({
    userId:     user.id,
    action:     'case.cs_updated',
    entityType: 'RepairOrder',
    entityId:   id,
    newValue:   { paymentStatus: data.paymentStatus, approveForMechanic: data.approveForMechanic },
  })

  return apiSuccess({ ok: true })
})
