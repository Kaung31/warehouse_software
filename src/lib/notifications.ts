/**
 * Phase B — customer-notification dispatcher.
 *
 * Inline send (Option A from the spec): after a CustomerNotification
 * row is inserted with status QUEUED, call sendNotification(row) and
 * mark it SENT or FAILED right away. No background queue.
 *
 * Resend for email, Twilio for SMS. If either provider's env vars are
 * missing we don't crash — we mark the row FAILED with a clear reason
 * so the audit trail shows what would have gone out and why it didn't.
 *
 * Failures are logged but never bubble up to the caller. Notifications
 * are best-effort: we don't want a flaky third party to block a status
 * transition for the warehouse team.
 */

import { Resend } from 'resend'
import twilio from 'twilio'
import { prisma } from './prisma'
import { signTrackToken } from './track-token'
import {
  triggerEventForStatus,
  notificationSubject,
  statusSentence,
} from './customerStatusCopy'
import {
  renderStatusChangeEmail,
  renderStatusChangeSms,
  renderTrackingLinkEmail,
  renderTrackingLinkSms,
} from './emailTemplates'

const FROM_EMAIL =
  process.env.NOTIFICATION_FROM_EMAIL ?? 'ScooterHub Repair <noreply@scooterhub.example>'
const FROM_PHONE = process.env.TWILIO_FROM_NUMBER ?? ''

/* Lazy provider clients — created the first time they're needed so a
 * missing key only matters when we actually try to send. */
let _resend: Resend | null = null
function getResend(): Resend | null {
  if (_resend) return _resend
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  _resend = new Resend(key)
  return _resend
}

let _twilio: ReturnType<typeof twilio> | null = null
function getTwilio() {
  if (_twilio) return _twilio
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  _twilio = twilio(sid, token)
  return _twilio
}

/** Build the customer-facing tracking URL for a given case using a
 *  fresh 1-hour token. */
async function buildTrackingUrl(orderId: string, orderNumber: string): Promise<string | null> {
  try {
    const token   = await signTrackToken(orderId)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000'
    return `${baseUrl.replace(/\/$/, '')}/track/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(token)}`
  } catch (err) {
    console.error('[notifications] buildTrackingUrl failed:', err)
    return null
  }
}

/* ─── Public API ──────────────────────────────────────────────────── */

/**
 * Enqueue + immediately send notifications for a status change.
 * No-op if:
 *   - the case isn't WARRANTY (B-grade has no customer)
 *   - the trigger status isn't in the wired-up trigger list
 *   - the customer's notificationPreference is NONE
 *   - the customer has no usable contact for their preferred channel(s)
 *
 * Catches and logs every error — never throws.
 */
export async function notifyStatusChange(args: {
  caseId:   string
  toStatus: string
}): Promise<void> {
  const { caseId, toStatus } = args
  const triggerEvent = triggerEventForStatus(toStatus)
  if (!triggerEvent) return

  try {
    const repair = await prisma.repairOrder.findUnique({
      where:  { id: caseId },
      select: {
        id:          true,
        orderNumber: true,
        caseType:    true,
        scooter:     { select: { brand: true, model: true } },
        customer: {
          select: {
            name:                   true,
            email:                  true,
            phone:                  true,
            notificationPreference: true,
          },
        },
      },
    })
    if (!repair || repair.caseType !== 'WARRANTY' || !repair.customer) return
    if (repair.customer.notificationPreference === 'NONE') return

    const wantsEmail =
      repair.customer.notificationPreference === 'EMAIL' ||
      repair.customer.notificationPreference === 'BOTH'
    const wantsSms =
      repair.customer.notificationPreference === 'SMS' ||
      repair.customer.notificationPreference === 'BOTH'

    const trackingUrl = await buildTrackingUrl(repair.id, repair.orderNumber)
    const sentence    = statusSentence(toStatus)

    if (wantsEmail && repair.customer.email) {
      const email = renderStatusChangeEmail({
        customerName:   repair.customer.name,
        orderNumber:    repair.orderNumber,
        scooter:        repair.scooter,
        statusSentence: sentence,
        trackingUrl,
        status:         toStatus,
      })
      await persistAndSend({
        caseId,
        channel:      'EMAIL',
        recipient:    repair.customer.email,
        subject:      email.subject,
        body:         email.html,
        textFallback: email.text,
        triggerEvent,
      })
    }

    if (wantsSms && repair.customer.phone) {
      const sms = renderStatusChangeSms({
        customerName:   repair.customer.name,
        orderNumber:    repair.orderNumber,
        statusSentence: sentence,
        trackingUrl,
      })
      await persistAndSend({
        caseId,
        channel:      'SMS',
        recipient:    repair.customer.phone,
        subject:      null,
        body:         sms,
        textFallback: sms,
        triggerEvent,
      })
    }
  } catch (err) {
    console.error('[notifications] notifyStatusChange failed (non-fatal):', err)
  }
}

/**
 * CS-triggered "send tracking link" — Step 9 button.
 * Honours the customer's preference (EMAIL / SMS / BOTH / NONE — for
 * NONE we still send because CS clicked the button explicitly; we just
 * surface an audit row with a note in the body).
 */
export async function sendManualTrackingLink(args: {
  caseId: string
}): Promise<{ ok: boolean; sentChannels: string[]; error: string | null }> {
  const { caseId } = args
  try {
    const repair = await prisma.repairOrder.findUnique({
      where:  { id: caseId },
      select: {
        id:          true,
        orderNumber: true,
        caseType:    true,
        scooter:     { select: { brand: true, model: true } },
        customer: {
          select: {
            name:                   true,
            email:                  true,
            phone:                  true,
            notificationPreference: true,
          },
        },
      },
    })
    if (!repair) return { ok: false, sentChannels: [], error: 'Case not found.' }
    if (repair.caseType !== 'WARRANTY') return { ok: false, sentChannels: [], error: 'Tracking links are only for warranty cases.' }
    if (!repair.customer) return { ok: false, sentChannels: [], error: 'Case has no customer.' }

    const trackingUrl = await buildTrackingUrl(repair.id, repair.orderNumber)
    if (!trackingUrl) return { ok: false, sentChannels: [], error: 'Could not generate tracking link.' }

    const sentChannels: string[] = []
    const pref = repair.customer.notificationPreference
    // CS-initiated send: respect prefs except NONE — for NONE, default
    // to email if there's an address (CS clicked deliberately).
    const useEmail =
      pref === 'EMAIL' || pref === 'BOTH' ||
      (pref === 'NONE' && !!repair.customer.email)
    const useSms =
      pref === 'SMS' || pref === 'BOTH'

    if (useEmail && repair.customer.email) {
      const email = renderTrackingLinkEmail({
        customerName:   repair.customer.name,
        orderNumber:    repair.orderNumber,
        scooter:        repair.scooter,
        statusSentence: '',
        trackingUrl,
      })
      const ok = await persistAndSend({
        caseId,
        channel:      'EMAIL',
        recipient:    repair.customer.email,
        subject:      email.subject,
        body:         email.html,
        textFallback: email.text,
        triggerEvent: 'MANUAL_LINK_SHARE',
      })
      if (ok) sentChannels.push('email')
    }

    if (useSms && repair.customer.phone) {
      const sms = renderTrackingLinkSms({
        customerName: repair.customer.name,
        orderNumber:  repair.orderNumber,
        trackingUrl,
      })
      const ok = await persistAndSend({
        caseId,
        channel:      'SMS',
        recipient:    repair.customer.phone,
        subject:      null,
        body:         sms,
        textFallback: sms,
        triggerEvent: 'MANUAL_LINK_SHARE',
      })
      if (ok) sentChannels.push('sms')
    }

    if (sentChannels.length === 0) {
      return {
        ok:    false,
        sentChannels,
        error: 'Customer has no email or phone matching their preference.',
      }
    }
    return { ok: true, sentChannels, error: null }
  } catch (err) {
    console.error('[notifications] sendManualTrackingLink failed:', err)
    return {
      ok: false, sentChannels: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/* ─── Internal: persist + send a single notification ─────────────── */

async function persistAndSend(args: {
  caseId:       string
  channel:      'EMAIL' | 'SMS'
  recipient:    string
  subject:      string | null
  body:         string         // HTML for email, plain for SMS
  textFallback: string         // plain text fallback for email
  triggerEvent: string
}): Promise<boolean> {
  const row = await prisma.customerNotification.create({
    data: {
      caseId:       args.caseId,
      channel:      args.channel,
      recipient:    args.recipient,
      status:       'QUEUED',
      subject:      args.subject,
      body:         args.body,
      triggerEvent: args.triggerEvent,
    },
  })

  let ok = false
  let errorMessage: string | null = null

  try {
    if (args.channel === 'EMAIL') {
      const resend = getResend()
      if (!resend) {
        errorMessage = 'RESEND_API_KEY missing — email not actually sent.'
      } else {
        const result = await resend.emails.send({
          from:    FROM_EMAIL,
          to:      args.recipient,
          subject: args.subject ?? notificationSubject('IN_REPAIR'),
          html:    args.body,
          text:    args.textFallback,
        })
        if (result.error) {
          errorMessage = result.error.message
        } else {
          ok = true
        }
      }
    } else {
      const tw = getTwilio()
      if (!tw) {
        errorMessage = 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing — SMS not actually sent.'
      } else if (!FROM_PHONE) {
        errorMessage = 'TWILIO_FROM_NUMBER missing — SMS not actually sent.'
      } else {
        const result = await tw.messages.create({
          from: FROM_PHONE,
          to:   args.recipient,
          body: args.body,
        })
        if (result.errorMessage) {
          errorMessage = result.errorMessage
        } else {
          ok = true
        }
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Send failed'
  }

  await prisma.customerNotification.update({
    where: { id: row.id },
    data:  ok
      ? { status: 'SENT',   sentAt: new Date(), errorMessage: null }
      : { status: 'FAILED', errorMessage: errorMessage ?? 'Unknown error' },
  })

  if (!ok) console.warn('[notifications] send failed:', { row: row.id, error: errorMessage })
  return ok
}
