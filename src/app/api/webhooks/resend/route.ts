import { NextRequest } from 'next/server'
import { Webhook } from 'svix'
import { apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * POST /api/webhooks/resend
 *
 * Resend signs every webhook with the same `svix` library Clerk uses.
 * The signing secret comes from your Resend dashboard → Webhooks.
 *
 * We update the matching `CustomerNotification` row to reflect what
 * happened to the email after we handed it off — DELIVERED, BOUNCED,
 * COMPLAINED, FAILED. The match is by `email_id` which Resend echoes
 * back in the payload — we store it on the notification when we send.
 *
 * Currently the dispatcher doesn't store Resend's email_id on the row
 * (the schema would need a field). For now we match on recipient +
 * createdAt as a best-effort. TODO once we add `providerMessageId`:
 * tighten this to a single-row exact match.
 */

type ResendEvent = {
  type: 'email.delivered' | 'email.bounced' | 'email.complained' | 'email.delivery_delayed' | 'email.opened' | 'email.clicked'
  data: {
    email_id?: string
    to:        string[]
    subject?:  string
    created_at?: string
  }
}

const STATUS_MAP: Record<string, string> = {
  'email.delivered':         'DELIVERED',
  'email.bounced':           'BOUNCED',
  'email.complained':        'BOUNCED',  // treat spam complaint same as bounce for our purposes
  'email.delivery_delayed':  'DELAYED',
  // open / click are interesting analytics but don't change status
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    logger.warn('resend webhook hit but RESEND_WEBHOOK_SECRET unset — accepting blind in dev')
  }

  const body    = await req.text()
  const headers = Object.fromEntries(req.headers)

  let event: ResendEvent
  try {
    if (secret) {
      const wh = new Webhook(secret)
      event = wh.verify(body, headers) as ResendEvent
    } else {
      event = JSON.parse(body) as ResendEvent
    }
  } catch (err) {
    logger.warn({ err }, 'resend webhook signature verification failed')
    return apiError('Invalid signature', 401)
  }

  const newStatus = STATUS_MAP[event.type]
  if (!newStatus) {
    return apiSuccess({ ignored: event.type })
  }

  // Best-effort match: recipient (to[0]) + most recent QUEUED/SENT row.
  const recipient = event.data.to?.[0]
  if (!recipient) return apiSuccess({ ignored: 'no recipient' })

  const row = await prisma.customerNotification.findFirst({
    where: {
      channel:   'EMAIL',
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
      errorMessage: newStatus === 'BOUNCED' ? `Resend reported ${event.type}` : null,
    },
  })

  logger.info({ notificationId: row.id, newStatus }, 'resend webhook processed')
  return apiSuccess({ updated: row.id, newStatus })
})
