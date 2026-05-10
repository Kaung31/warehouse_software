import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { changeStatusSchema, STATUS_TRANSITIONS } from '@/lib/schemas/repair'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { ScooterStatus, RepairStatus } from '@prisma/client'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

type Ctx = { params: Promise<{ id: string }> }

export const PUT = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('repair:update')
  const { id } = await (ctx as Ctx).params

  const repair = await prisma.repairOrder.findUnique({
    where: { id },
    include: { scooter: true },
  })
  if (!repair) return apiError('Repair order not found', 404)

  // Mechanics can only update their own
  if (user.role === 'MECHANIC' && repair.mechanicId !== user.id) throw new Error('FORBIDDEN')

  const { data, error } = await parseBody(req, changeStatusSchema)
  if (error) return error

  // Enforce the state machine — you cannot skip steps
  const allowed = STATUS_TRANSITIONS[repair.status]
  if (!allowed.includes(data.status)) {
    return apiError(
      `Cannot change status from ${repair.status} to ${data.status}. Allowed: ${allowed.join(', ')}`,
      400
    )
  }

  // Map repair status to scooter status
  const scooterStatusMap: Partial<Record<RepairStatus, ScooterStatus>> = {
    READY_TO_SHIP: ScooterStatus.READY_TO_SHIP,
    DISPATCHED:    ScooterStatus.DISPATCHED,
    CANCELLED:     ScooterStatus.WITH_CUSTOMER,
  }

  await prisma.$transaction(async (tx) => {
    // Update repair status
    await tx.repairOrder.update({
      where: { id },
      data:  {
        status:   data.status,
        closedAt: data.status === 'DISPATCHED' ? new Date() : undefined,
      },
    })

    // Update scooter status if needed
    const newScooterStatus = scooterStatusMap[data.status]
    if (newScooterStatus) {
      await tx.scooter.update({
        where: { id: repair.scooterId },
        data:  { status: newScooterStatus },
      })
    }
  })

  await logAudit({
    userId:     user.id,
    action:     'repair_order.status_changed',
    entityType: 'RepairOrder',
    entityId:   id,
    oldValue:   { status: repair.status },
    newValue:   { status: data.status, notes: data.notes },
  })

  await invalidateCaseCache(id)

  // Phase B — fire customer notification if the new status is in the
  // trigger list (DISPATCHED, DELIVERED, READY_TO_SHIP, etc.). The
  // dispatcher itself filters the trigger list so no extra check here.
  await enqueue('notify-status-change', { caseId: id, toStatus: data.status })
  await broadcastCaseUpdate({ caseId: id, toStatus: data.status, type: 'status_change' })

  return apiSuccess({ id, status: data.status })
})