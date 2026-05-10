/**
 * Phase B — outbound email templates.
 *
 * Plain HTML, no template engine, no JSX-in-strings. The body stays
 * intentionally simple so it renders well in any email client.
 *
 * Each template returns { subject, html, text } — `text` is the plain
 * fallback (and what we send via SMS too). `html` is what email clients
 * actually render.
 */

import { notificationSubject } from './customerStatusCopy'

export type RenderedEmail = {
  subject: string
  html:    string
  text:    string
}

export type EmailTemplateContext = {
  customerName: string
  orderNumber:  string
  scooter:      { brand: string; model: string }
  /** Friendly status sentence (from customerStatusCopy.statusSentence). */
  statusSentence: string
  /** Tracking URL (token already embedded). May be null when CS hasn't
   *  generated one — we just omit the CTA. */
  trackingUrl:  string | null
}

/* ─── Status-change email ─────────────────────────────────────────── */

export function renderStatusChangeEmail(args: EmailTemplateContext & {
  status: string
}): RenderedEmail {
  const { customerName, orderNumber, scooter, statusSentence, trackingUrl, status } = args
  const subject = notificationSubject(status)
  const text = [
    `Hi ${customerName},`,
    '',
    `${statusSentence}`,
    '',
    `Order: ${orderNumber}`,
    `Scooter: ${scooter.brand} ${scooter.model}`,
    trackingUrl ? `\nCheck your repair: ${trackingUrl}` : '',
    '',
    '— ScooterHub Repair Centre',
  ].filter(Boolean).join('\n')

  const html = wrapHtml({
    title: subject,
    body: `
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>${escapeHtml(statusSentence)}</p>
      <table role="presentation" style="font-size:14px;color:#444;margin:18px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#777">Order</td><td style="font-family:monospace">${escapeHtml(orderNumber)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#777">Scooter</td><td>${escapeHtml(scooter.brand)} ${escapeHtml(scooter.model)}</td></tr>
      </table>
      ${trackingUrl ? `<p><a href="${trackingUrl}" style="background:#1a5fff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Check your repair</a></p>` : ''}
      <p style="font-size:12px;color:#888;margin-top:24px">This link is private to you and expires in one hour.</p>
    `,
  })

  return { subject, html, text }
}

/* ─── Manual tracking-link share (Step 9) ─────────────────────────── */

export function renderTrackingLinkEmail(args: EmailTemplateContext): RenderedEmail {
  const { customerName, orderNumber, scooter, trackingUrl } = args
  const subject = 'Track your repair'
  const text = [
    `Hi ${customerName},`,
    '',
    `Here's a private link to check on your repair:`,
    trackingUrl ?? '(link unavailable — please contact us)',
    '',
    `Order: ${orderNumber}`,
    `Scooter: ${scooter.brand} ${scooter.model}`,
    '',
    'The link is valid for one hour. After that you can request a fresh link from our team or visit /track and enter your details.',
    '',
    '— ScooterHub Repair Centre',
  ].join('\n')

  const html = wrapHtml({
    title: subject,
    body: `
      <p>Hi ${escapeHtml(customerName)},</p>
      <p>Here&rsquo;s a private link to check on your repair:</p>
      ${trackingUrl ? `<p><a href="${trackingUrl}" style="background:#1a5fff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Open my repair tracker</a></p>` : ''}
      <table role="presentation" style="font-size:14px;color:#444;margin:18px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#777">Order</td><td style="font-family:monospace">${escapeHtml(orderNumber)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#777">Scooter</td><td>${escapeHtml(scooter.brand)} ${escapeHtml(scooter.model)}</td></tr>
      </table>
      <p style="font-size:12px;color:#888;margin-top:24px">The link is valid for one hour. After that, you can request a fresh link from our team or visit our tracker page.</p>
    `,
  })

  return { subject, html, text }
}

/* ─── SMS template ────────────────────────────────────────────────── */

export function renderStatusChangeSms(args: {
  customerName:   string
  orderNumber:    string
  statusSentence: string
  trackingUrl:    string | null
}): string {
  const { customerName, orderNumber, statusSentence, trackingUrl } = args
  // Keep it under ~320 chars (2 SMS segments). Twilio handles long
  // messages, but cost scales by segment.
  const lines = [
    `Hi ${customerName},`,
    statusSentence,
    `Order ${orderNumber}.`,
    trackingUrl ? trackingUrl : '',
  ].filter(Boolean)
  return lines.join(' ')
}

export function renderTrackingLinkSms(args: {
  customerName: string
  orderNumber:  string
  trackingUrl:  string
}): string {
  return [
    `Hi ${args.customerName},`,
    `Track your repair (${args.orderNumber}):`,
    args.trackingUrl,
    `Link valid for 1 hour.`,
  ].join(' ')
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function wrapHtml({ title, body }: { title: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:28px 32px;text-align:left;line-height:1.55;font-size:14px">
          <tr><td>
            <div style="font-size:13px;font-weight:600;color:#1a5fff;letter-spacing:.04em;text-transform:uppercase;margin-bottom:18px">ScooterHub</div>
            ${body}
          </td></tr>
        </table>
        <p style="font-size:11px;color:#999;margin:18px 0 0 0">© ScooterHub Repair Centre</p>
      </td></tr>
    </table>
  </body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
