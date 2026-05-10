import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { sendManualTrackingLink } from '@/lib/notifications'

/**
 * POST /api/cases/[id]/send-tracking-link
 *
 * CS / admin / manager-triggered: emails (and SMS-es, depending on the
 * customer's preference) a fresh tracking link to the customer.
 *
 * Reuses the same notification dispatcher as the auto-fired status
 * change emails; one CustomerNotification audit row is inserted per
 * channel sent, with triggerEvent = 'MANUAL_LINK_SHARE'.
 */

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:cs_update') // ADMIN / MANAGER / CS
  const { id } = await (ctx as Ctx).params

  const result = await sendManualTrackingLink({ caseId: id })
  if (!result.ok) {
    return apiError(result.error ?? 'Failed to send tracking link.', 400)
  }

  await logAudit({
    userId:     user.id,
    action:     'case.tracking_link_sent',
    entityType: 'RepairOrder',
    entityId:   id,
    newValue:   { sentChannels: result.sentChannels },
  })

  return apiSuccess({ sentChannels: result.sentChannels })
})
