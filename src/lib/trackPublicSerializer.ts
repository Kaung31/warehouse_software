/**
 * Phase B — strict whitelist serializer for the customer-facing portal.
 *
 * EVERY field returned to the public client passes through this file.
 * The default is to NOT include something — if you need to add a new
 * field, you have to edit `PublicTrackPayload` and the explicit copy in
 * `serializePublicTrack()`. This makes accidental PII leaks much
 * harder.
 *
 * Banned fields (per spec):
 *   - Customer's full address (only town/city ok)
 *   - Internal staff names
 *   - Internal status enum strings (we map to customer stages instead)
 *   - Mechanic notes / internal comments
 *   - Pricing / invoice details (unless paymentStatus = PAID)
 *   - Recharge specifics (just say "additional work")
 *   - Dispute details
 *   - Other customers' info
 *   - Photos taken DURING repair — only intake photos
 *
 * The intake photo gate is by `photoType`: SCOOTER_INBOUND and
 * CUSTOMER_REPORT are intake-equivalent and visible. Everything else
 * (REPAIR_EVIDENCE, SCOOTER_OUTBOUND, DAMAGE_REPORT) stays internal.
 */

import { prisma } from './prisma'
import { getViewUrl } from './r2'
import {
  statusToStage,
  statusSentence,
  timelineEvent,
  estimatedCompletionLabel,
  type CustomerStage,
} from './customerStatusCopy'

export type PublicTimelineEvent = {
  message: string
  at:      string  // ISO
}

export type PublicTrackPayload = {
  orderNumber:           string
  scooter: {
    brand: string
    model: string
    // NO serialNumber — privacy
  }
  startedAt:             string  // ISO — repairStartedAt or createdAt
  estimatedCompletion:   string  // human-readable label
  customerStage:         CustomerStage
  statusMessage:         string
  /** True when the customer should see the case as closed (cancelled,
   *  declined, delivered) so the page can render a different layout. */
  isClosed:              boolean
  trackingNumber:        string | null
  carrier:               string | null
  /** Carrier deep link, when we can build one. Null otherwise — the
   *  page renders a copy-to-clipboard pill instead. */
  trackingUrl:           string | null
  intakePhotos:          { id: string; url: string; caption: string | null }[]
  timeline:              PublicTimelineEvent[]
  /** When the page last reflected fresh data — for "Last updated" line. */
  fetchedAt:             string
}

/** Photo types intake-equivalent — what CS / inbound captured before
 *  the mechanic touched it. EVERYTHING else is internal-only. */
const INTAKE_PHOTO_TYPES: ReadonlyArray<string> = [
  'SCOOTER_INBOUND',
  'CUSTOMER_REPORT',
]

/** Build a carrier tracking URL for the few carriers we know. */
function buildTrackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!carrier || !tracking) return null
  const c = carrier.toUpperCase()
  if (c === 'DPD')   return `https://track.dpd.co.uk/parcels/${encodeURIComponent(tracking)}`
  if (c === 'ROYAL_MAIL' || c === 'ROYALMAIL') {
    return `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(tracking)}`
  }
  return null
}

/**
 * Loads everything we need for the public payload in a single query +
 * a parallel R2 signing pass for intake photos.
 */
export async function serializePublicTrack(orderId: string): Promise<PublicTrackPayload | null> {
  const c = await prisma.repairOrder.findUnique({
    where: { id: orderId },
    select: {
      id:                true,
      orderNumber:       true,
      caseType:          true,
      status:            true,
      createdAt:         true,
      closedAt:          true,
      repairStartedAt:   true,

      scooter:           { select: { brand: true, model: true } },

      shipments: {
        orderBy: { createdAt: 'desc' },
        take:    1,
        select:  { trackingNumber: true, carrier: true, status: true },
      },

      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select:  { toStatus: true, createdAt: true },
      },
    },
  })

  if (!c) return null
  if (c.caseType !== 'WARRANTY') return null

  // Intake photos — separate query (CasePhoto isn't on RepairOrder via
  // a relation, it's a polymorphic table keyed by entityType+entityId).
  const photoRows = await prisma.photo.findMany({
    where: {
      entityType: 'RepairOrder',
      entityId:   c.id,
      photoType:  { in: INTAKE_PHOTO_TYPES as never[] },
    },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, s3Key: true, caption: true },
  })
  const intakePhotos = await Promise.all(
    photoRows.map(async (p) => {
      try {
        // Phase 4: customer page never serves originals — `medium` is
        // 800 px AVIF/WebP, ~30 KB, plenty for the public gallery.
        return { id: p.id, url: await getViewUrl(p.s3Key, 'medium'), caption: p.caption }
      } catch {
        return null
      }
    }),
  ).then((arr) => arr.filter(Boolean) as { id: string; url: string; caption: string | null }[])

  // Build the public timeline — drop hidden events and dedupe consecutive
  // duplicates (the IN_REPAIR status is written by both `claim` and
  // `start-repair`, plus once more on awaiting-parts resume).
  const timeline: PublicTimelineEvent[] = []
  let lastVisibleStatus = ''
  for (const h of c.statusHistory) {
    const ev = timelineEvent(h.toStatus)
    if (!ev.visible) continue
    if (h.toStatus === lastVisibleStatus) continue
    timeline.push({ message: ev.message, at: h.createdAt.toISOString() })
    lastVisibleStatus = h.toStatus
  }

  const shipment = c.shipments[0] ?? null

  // Only expose tracking when we're actually shipping or shipped.
  const trackingExposed =
    c.status === 'DISPATCHED' || c.status === 'DELIVERED'
  const trackingNumber = trackingExposed ? shipment?.trackingNumber ?? null : null
  const carrier        = trackingExposed ? shipment?.carrier ?? null        : null
  const trackingUrl    = buildTrackingUrl(carrier, trackingNumber)

  const isClosed =
    c.status === 'DELIVERED' ||
    c.status === 'CANCELLED' ||
    c.status === 'CUSTOMER_DECLINED'

  return {
    orderNumber:         c.orderNumber,
    scooter:             { brand: c.scooter.brand, model: c.scooter.model },
    startedAt:           (c.repairStartedAt ?? c.createdAt).toISOString(),
    estimatedCompletion: estimatedCompletionLabel({
      status:    c.status,
      createdAt: c.createdAt,
      closedAt:  c.closedAt,
    }),
    customerStage:       statusToStage(c.status),
    statusMessage:       statusSentence(c.status),
    isClosed,
    trackingNumber,
    carrier,
    trackingUrl,
    intakePhotos,
    timeline,
    fetchedAt:           new Date().toISOString(),
  }
}
