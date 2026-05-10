import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  requireAuth,
  parseBody,
  apiSuccess,
  apiError,
  withErrorHandler,
} from '@/lib/api-helpers'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

/**
 * POST /api/cases/[id]/escalate-to-cs
 *
 * Called by inbound or mechanic when they find scope beyond what CS
 * originally quoted. The case loops back to CS for re-quoting.
 *
 * Body:
 *   {
 *     reason: string                                     (required)
 *     origin: 'INBOUND_DIAGNOSIS' | 'MECHANIC_REPAIR'    (optional — auto-detected from current status if missing)
 *   }
 *
 * Side effects:
 *   - Sets case.status to AWAITING_CS
 *   - Records rechargeOrigin / rechargeReason / rechargeRequestedAt
 *   - Sets returnToStatus = the previous status (so when CS resolves,
 *     the case knows where to go back to)
 *   - Writes a CaseStatusHistory entry with a recharge-specific message
 *
 * Permissions:
 *   - ADMIN, MANAGER, WAREHOUSE (inbound), MECHANIC
 *   - Plain CS users can't escalate to themselves
 */

const bodySchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(2000),
  origin: z.enum(['INBOUND_DIAGNOSIS', 'MECHANIC_REPAIR']).optional(),
})

/**
 * Decide where the case should return to once CS resolves the recharge.
 * Based on the status the case was IN when escalation happened:
 *   - From AWAITING_INBOUND → return to AWAITING_INBOUND
 *   - From IN_REPAIR / WAITING_FOR_MECHANIC → return to IN_REPAIR
 *   - Anything else → return to the same status (best guess)
 */
function inferReturnStatus(currentStatus: string): string {
  if (currentStatus === 'AWAITING_INBOUND') return 'AWAITING_INBOUND'
  if (
    currentStatus === 'IN_REPAIR' ||
    currentStatus === 'WAITING_FOR_MECHANIC' ||
    currentStatus === 'AWAITING_PARTS'
  ) {
    return 'IN_REPAIR'
  }
  return currentStatus
}

/** Auto-detect origin from current status if the client didn't send one. */
function inferOrigin(
  currentStatus: string
): 'INBOUND_DIAGNOSIS' | 'MECHANIC_REPAIR' | null {
  if (currentStatus === 'AWAITING_INBOUND') return 'INBOUND_DIAGNOSIS'
  if (
    currentStatus === 'IN_REPAIR' ||
    currentStatus === 'WAITING_FOR_MECHANIC' ||
    currentStatus === 'AWAITING_PARTS'
  ) {
    return 'MECHANIC_REPAIR'
  }
  return null
}

/** Friendly status history message based on origin. */
function buildHistoryMessage(
  origin: 'INBOUND_DIAGNOSIS' | 'MECHANIC_REPAIR',
  reason: string
): string {
  const prefix =
    origin === 'INBOUND_DIAGNOSIS'
      ? 'Inbound found bigger scope — sent to CS for recharge'
      : 'Mechanic found additional damage — sent to CS for recharge'
  return `${prefix}: ${reason}`
}


export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth()

  // Role check — CS users shouldn't be able to escalate to themselves
  const allowedRoles = ['ADMIN', 'MANAGER', 'WAREHOUSE', 'MECHANIC']
  if (!allowedRoles.includes(user.role)) {
    return apiError(
      'Only inbound, mechanic, manager, or admin can escalate to CS',
      403
    )
  }

  const params = (ctx as { params: Promise<{ id: string }> })?.params
  if (!params) return apiError('Missing case id', 400)
  const { id } = await params

  const { data, error } = await parseBody(req, bodySchema)
  if (error) return error

  // Look up the case to find its current status and existing recharge fields
  const repair = await prisma.repairOrder.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      rechargeOrigin: true,
      rechargeReason: true,
    },
  })
  if (!repair) return apiError('Case not found', 404)

  // Don't allow if recharge is already recorded (would overwrite existing data).
  // BUT: allow when status is AWAITING_CS without recharge data — this happens
  // when the inbound triage call ran first (which sets status to AWAITING_CS
  // for the "send to CS for confirmation" path) and then this recharge call
  // runs immediately after. We need to add the recharge data on top.
  if (repair.rechargeOrigin || repair.rechargeReason) {
    return apiError(
      'A recharge is already recorded on this case',
      400
    )
  }
  if (repair.status === 'DISPUTED') {
    return apiError('Cannot escalate a disputed case', 400)
  }

  // Determine the "from status" — if the case was just moved to AWAITING_CS
  // by the triage call, we need to know what it WAS before that to set the
  // proper returnToStatus and origin. We look at the most recent status
  // history entry to find the previous status.
  let fromStatus = repair.status
  if (fromStatus === 'AWAITING_CS') {
    const lastHistory = await prisma.caseStatusHistory.findFirst({
      where: { caseId: id, toStatus: 'AWAITING_CS' },
      orderBy: { createdAt: 'desc' },
      select: { fromStatus: true },
    })
    if (lastHistory?.fromStatus) {
      fromStatus = lastHistory.fromStatus as typeof fromStatus
    }
  }

  // Resolve origin (from body or inferred from the original status)
  const origin = data.origin ?? inferOrigin(fromStatus)
  if (!origin) {
    return apiError(
      `Cannot escalate from status ${fromStatus}`,
      400
    )
  }

  const returnToStatus = inferReturnStatus(fromStatus)
  const now = new Date()
  const historyReason = buildHistoryMessage(origin, data.reason.trim())

  // Atomic update: set recharge fields on the case + write history entry
  await prisma.$transaction(async tx => {
    await tx.repairOrder.update({
      where: { id },
      data: {
        status: 'AWAITING_CS',
        rechargeOrigin: origin,
        rechargeReason: data.reason.trim(),
        rechargeRequestedAt: now,
        returnToStatus: returnToStatus as never,
      },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId: id,
        fromStatus: fromStatus,
        toStatus: 'AWAITING_CS',
        changedById: user.id,
        reason: historyReason,
      },
    })
  })

  await invalidateCaseCache(id)

  // Phase B — fire the recharge notification. The actual DB status is
  // AWAITING_CS but the customer-facing trigger key is CS_RECHARGE so
  // they get the "additional work needed" copy rather than a generic
  // "we're reviewing" message. The notification dispatcher resolves
  // `triggerEventForStatus('CS_RECHARGE')` correctly.
  await enqueue('notify-status-change', { caseId: id, toStatus: 'CS_RECHARGE' })
  await broadcastCaseUpdate({ caseId: id, toStatus: 'AWAITING_CS', role: 'CS', type: 'status_change' })

  return apiSuccess({
    ok: true,
    caseId: id,
    fromStatus: fromStatus,
    toStatus: 'AWAITING_CS',
    rechargeOrigin: origin,
    returnToStatus,
  })
})