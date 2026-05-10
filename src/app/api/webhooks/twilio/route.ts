import { NextRequest } from 'next/server'
import twilio from 'twilio'
import { apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * POST /api/webhooks/twilio
 *
 * Twilio sends URL-encoded form data, not JSON. The signature is in
 * the `x-twilio-signature` header and validated against the request
 * URL + the sorted form fields with `TwilioWebhookSecret` (your auth
 * token works as the validation key).
 *
 * Status mapping:
 *   - delivered      → DELIVERED
 *   - undelivered    → BOUNCED
 *   - failed         → FAILED
 *   - sent / queued  → ignored (we already track these locally)
 */

const STATUS_MAP: Record<string, string> = {
  delivered:   'DELIVERED',
  undelivered: 'BOUNCED',
  failed:      'FAILED',
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const url       = req.nextUrl.toString()
  const sig       = req.headers.get('x-twilio-signature') ?? ''

  const formText = await req.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(formText)) params[k] = v

  if (authToken) {
    const valid = twilio.validateRequest(authToken, sig, url, params)
    if (!valid) {
      logger.warn('twilio webhook signature invalid')
      return apiError('Invalid signature', 401)
    }
  } else {
    logger.warn('twilio webhook hit but TWILIO_AUTH_TOKEN unset — accepting blind in dev')
  }

  const status     = (params.MessageStatus ?? '').toLowerCase()
  const recipient  = params.To
  const newStatus  = STATUS_MAP[status]
  if (!newStatus || !recipient) {
    return apiSuccess({ ignored: status || 'no recipient' })
  }

  const row = await prisma.customerNotification.findFirst({
    where: {
      channel:   'SMS',
      recipient,
      status:    { in: ['QUEUED', 'SENT'] },
    },
    orderBy: { createdAt: 'desc' },
    select:  { id: true },
  })
  if (!row) return apiSuccess({ ignored: 'no matching notification' })

  await prisma.customerNotification.update({
    where: { id: row.id },
    data:  {
      status:       newStatus,
      errorMessage: newStatus !== 'DELIVERED' ? `Twilio reported ${status}` : null,
    },
  })

  logger.info({ notificationId: row.id, newStatus }, 'twilio webhook processed')
  return apiSuccess({ updated: row.id, newStatus })
})
