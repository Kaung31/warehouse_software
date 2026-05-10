import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { autoSetLocation } from '@/lib/autoLocation'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id } = await (ctx as Ctx).params

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)

  if (!['WAITING_FOR_MECHANIC', 'QC_FAILED', 'BGRADE_RECORDED'].includes(existing.status)) {
    return apiError(`Cannot start repair on case in status ${existing.status}`, 400)
  }

  // Mechanics can only work on assigned or unassigned cases
  if (user.role === 'MECHANIC' && existing.mechanicId && existing.mechanicId !== user.id) {
    return apiError('This case is assigned to another mechanic', 403)
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.repairOrder.update({
      where: { id },
      data: {
        status:         'IN_REPAIR',
        repairStartedAt: now,
        mechanicId:     existing.mechanicId ?? user.id,
      },
    })

    // Upsert time log (re-starting resets timer)
    await tx.repairTimeLog.upsert({
      where:  { caseId: id },
      create: { caseId: id, mechanicId: user.id, startedAt: now },
      update: { startedAt: now, completedAt: null, durationMinutes: null, mechanicId: user.id },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  existing.status,
        toStatus:    'IN_REPAIR',
        changedById: user.id,
        reason:      'Mechanic started repair',
      },
    })
  })

  await autoSetLocation(id, 'IN_REPAIR')

  await logAudit({
    userId: user.id, action: 'case.repair_started',
    entityType: 'RepairOrder', entityId: id,
    newValue: { startedAt: now.toISOString() },
  })

  await invalidateCaseCache(id)

  // Phase B — notify the customer the repair has started.
  await enqueue('notify-status-change', { caseId: id, toStatus: 'IN_REPAIR' })
  await broadcastCaseUpdate({ caseId: id, toStatus: 'IN_REPAIR', role: 'MECHANIC', type: 'status_change' })

  return apiSuccess({ startedAt: now })
})
