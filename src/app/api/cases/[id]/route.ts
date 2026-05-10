import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:view')
  const { id } = await (ctx as Ctx).params

  const caseRecord = await prisma.repairOrder.findUnique({
    where: { id },
    include: {
      customer:    true,
      scooter:     true,
      mechanic:    { select: { id: true, name: true, role: true } },
      repairParts: { include: { part: { select: { id: true, name: true, sku: true, barcode: true, stockQty: true, unitCost: true } } } },
      shipments:   true,
      errorCodes:  { orderBy: { createdAt: 'asc' } },
      invoice:     true,
      repairTimeLog: true,
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        include: { changedBy: { select: { id: true, name: true, role: true } } },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, role: true } } },
      },
      qcSubmissions: {
        orderBy: { submittedAt: 'desc' },
        take: 1,
        include: {
          results: {
            include: { template: true },
            orderBy: { createdAt: 'asc' },
          },
          submittedBy: { select: { name: true } },
        },
      },
    },
  })

  if (!caseRecord) return apiError('Case not found', 404)

  // Mechanics can only see their own cases (or unassigned ones waiting for mechanic)
  if (user.role === 'MECHANIC' &&
      caseRecord.mechanicId !== user.id &&
      caseRecord.status !== 'WAITING_FOR_MECHANIC') {
    return apiError('Not found', 404)
  }

  // CS cannot see mechanic-only notes on non-CS stages — keep it simple, return all
  return apiSuccess(caseRecord)
})

// DELETE — cancels a case (ADMIN / MANAGER only).
// Cases in early stages (AWAITING_INBOUND, BGRADE_RECORDED) are hard-deleted.
// Cases that have progressed are transitioned to CANCELLED to preserve history.
export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:cs_update') // reuse — only CS+ can cancel
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return apiError('Only admins and managers can delete cases', 403)
  }

  const { id } = await (ctx as Ctx).params
  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)

  if (existing.status === 'DISPATCHED') {
    return apiError('Cannot delete a dispatched case', 400)
  }

  const earlyStatuses = ['AWAITING_INBOUND', 'BGRADE_RECORDED']
  if (earlyStatuses.includes(existing.status)) {
    // Hard delete — nothing has happened yet
    await prisma.repairOrder.delete({ where: { id } })
    await logAudit({ userId: user.id, action: 'case.deleted', entityType: 'RepairOrder', entityId: id, oldValue: { status: existing.status, orderNumber: existing.orderNumber } })
    return apiSuccess({ deleted: true })
  }

  // Soft cancel — preserve history
  await prisma.$transaction(async tx => {
    await tx.repairOrder.update({ where: { id }, data: { status: 'CANCELLED' } })
    await tx.caseStatusHistory.create({
      data: { caseId: id, fromStatus: existing.status, toStatus: 'CANCELLED', changedById: user.id, reason: 'Cancelled by admin' },
    })
  })
  await logAudit({ userId: user.id, action: 'case.cancelled', entityType: 'RepairOrder', entityId: id, oldValue: { status: existing.status } })
  return apiSuccess({ cancelled: true })
})
