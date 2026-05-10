import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { autoSetLocation } from '@/lib/autoLocation'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/cases/[id]/claim
//
// Mechanic self-claims a case from the shared queue.
//
// Permission: case:start_repair (ADMIN | MANAGER | MECHANIC).
//
// Preconditions:
//   * Case exists.
//   * Case status is WAITING_FOR_MECHANIC.
//   * Case mechanicId is null (otherwise it's already claimed).
//   * Mechanic does not already have an IN_REPAIR case (one active job at a time).
//
// Effects (atomic):
//   * mechanicId   = caller
//   * status       = IN_REPAIR    (also for BGRADE — the schema has no
//                                   BGRADE_IN_ASSESSMENT enum, so we follow the
//                                   existing start-repair convention)
//   * repairStartedAt = now
//   * RepairTimeLog upserted, started now
//   * CaseStatusHistory row written
//   * Auto-set location to MECH_Q
export const POST = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id } = await (ctx as Ctx).params

  const existing = await prisma.repairOrder.findUnique({
    where: { id },
    select: {
      id:         true,
      status:     true,
      mechanicId: true,
      caseType:   true,
      orderNumber:true,
    },
  })
  if (!existing) return apiError('Case not found', 404)

  if (existing.status !== 'WAITING_FOR_MECHANIC') {
    return apiError(
      `Cannot claim a case in status ${existing.status}. Only cases waiting for a mechanic can be claimed.`,
      400,
    )
  }

  if (existing.mechanicId && existing.mechanicId !== user.id) {
    return apiError('This case has already been claimed by another mechanic.', 409)
  }

  // Mechanic conflict check — one active job per mechanic.
  // Admins/managers can claim on behalf without this restriction.
  if (user.role === 'MECHANIC') {
    const conflicting = await prisma.repairOrder.findFirst({
      where: {
        mechanicId: user.id,
        status:     'IN_REPAIR',
        NOT:        { id },
      },
      select: { id: true, orderNumber: true },
    })
    if (conflicting) {
      return apiError(
        `You already have an active job (${conflicting.orderNumber}). Finish or pause it before claiming another.`,
        409,
      )
    }
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.repairOrder.update({
      where: { id },
      data: {
        mechanicId:      user.id,
        status:          'IN_REPAIR',
        repairStartedAt: now,
      },
    })

    await tx.repairTimeLog.upsert({
      where:  { caseId: id },
      create: { caseId: id, mechanicId: user.id, startedAt: now },
      update: { mechanicId: user.id, startedAt: now, completedAt: null, durationMinutes: null },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  existing.status,
        toStatus:    'IN_REPAIR',
        changedById: user.id,
        reason:      'Mechanic claimed the case from the queue',
      },
    })
  })

  await autoSetLocation(id, 'IN_REPAIR')

  await logAudit({
    userId:     user.id,
    action:     'case.claimed',
    entityType: 'RepairOrder',
    entityId:   id,
    newValue:   { mechanicId: user.id, startedAt: now.toISOString() },
  })

  await invalidateCaseCache(id)

  // Phase B — notify the customer the repair has started.
  await enqueue('notify-status-change', { caseId: id, toStatus: 'IN_REPAIR' })
  await broadcastCaseUpdate({ caseId: id, toStatus: 'IN_REPAIR', role: 'MECHANIC', type: 'mechanic_assigned' })

  return apiSuccess({
    id,
    mechanicId: user.id,
    status:     'IN_REPAIR',
    startedAt:  now,
  })
})
