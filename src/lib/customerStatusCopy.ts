/**
 * Phase B — customer-facing status copy.
 *
 * Single source of truth for everything the customer sees about their
 * repair, used by both the public /track/[orderNumber] page and the
 * outbound notification subjects/bodies.
 *
 * Goals:
 *   1. Translate internal RepairStatus enum strings → customer-friendly
 *      stages and sentences.
 *   2. Hide internal-only events (mechanic claim/release, status loops)
 *      from the public timeline.
 *   3. Tell the notification dispatcher which status changes warrant a
 *      customer message.
 *   4. Compute a sensible "around <date>" ETA.
 */

/* ─── Customer stages (5-step pipeline) ────────────────────────────── */

export type CustomerStage =
  | 'BOOKED'
  | 'RECEIVED'
  | 'IN_REPAIR'
  | 'QC'
  | 'READY'
  | 'CLOSED' // CANCELLED / DECLINED — show outside the pipeline

export const CUSTOMER_STAGES: ReadonlyArray<{
  key:   Exclude<CustomerStage, 'CLOSED'>
  label: string
}> = [
  { key: 'BOOKED',     label: 'Booked' },
  { key: 'RECEIVED',   label: 'Received' },
  { key: 'IN_REPAIR',  label: 'In repair' },
  { key: 'QC',         label: 'Quality check' },
  { key: 'READY',      label: 'Ready' },
]

/** Map internal RepairStatus → customer-visible 5-stage pipeline. */
export function statusToStage(status: string): CustomerStage {
  switch (status) {
    case 'NEW':
    case 'CS_TRIAGE':
    case 'QUOTE_SENT':
    case 'AWAITING_PICKUP':
    case 'IN_TRANSIT':
      return 'BOOKED'

    case 'AWAITING_INBOUND':
    case 'INBOUND_DIAGNOSIS':
    case 'AWAITING_CS':
    case 'CS_RECHARGE':
    case 'WAITING_FOR_MECHANIC':
    case 'RECEIVED':         // legacy
    case 'DIAGNOSING':       // legacy
      return 'RECEIVED'

    case 'IN_REPAIR':
    case 'AWAITING_PARTS':
    case 'QC_FAILED':        // bounce back from QC — still "in repair" externally
      return 'IN_REPAIR'

    case 'QUALITY_CONTROL':
    case 'QUALITY_CHECK':    // legacy
      return 'QC'

    case 'READY_TO_SHIP':
    case 'DISPATCHED':
    case 'DELIVERED':
      return 'READY'

    case 'CANCELLED':
    case 'CUSTOMER_DECLINED':
    case 'DISPUTED':         // surface as 'closed-ish' — page renders a contact-us message
    case 'BGRADE_RECORDED':  // shouldn't happen for warranty cases but defensive
      return 'CLOSED'

    default:
      return 'BOOKED'
  }
}

/* ─── Status sentence (one-liner shown on the page) ────────────────── */

export function statusSentence(status: string): string {
  switch (status) {
    case 'NEW':
    case 'CS_TRIAGE':
      return 'We\'ve received your booking and our team is reviewing it.'
    case 'QUOTE_SENT':
      return 'We\'ve sent you a quote — please reply when you\'re ready to proceed.'
    case 'AWAITING_PICKUP':
      return 'We\'re waiting for you to send the scooter to us.'
    case 'IN_TRANSIT':
      return 'Your scooter is in transit to our workshop.'

    case 'AWAITING_INBOUND':
      return 'We\'re expecting your scooter to arrive soon.'
    case 'INBOUND_DIAGNOSIS':
      return 'Your scooter has arrived — we\'re checking it over.'
    case 'AWAITING_CS':
      return 'Our customer service team is reviewing your case.'
    case 'CS_RECHARGE':
      return 'We\'ve found additional work needed. Our team will contact you with a quote.'
    case 'CUSTOMER_DECLINED':
      return 'You declined the additional work. We\'ll return your scooter as-is.'
    case 'DISPUTED':
      return 'There\'s a question about your repair — our team will be in touch.'

    case 'WAITING_FOR_MECHANIC':
      return 'Your scooter is queued for repair.'
    case 'IN_REPAIR':
      return 'Our technician is working on your scooter now.'
    case 'AWAITING_PARTS':
      return 'We\'re waiting on parts to complete your repair.'
    case 'QC_FAILED':
      // Don't reveal the QC bounce externally — keep it generic.
      return 'Our technician is making a final adjustment.'

    case 'QUALITY_CONTROL':
      return 'Final quality check in progress.'

    case 'READY_TO_SHIP':
      return 'Your scooter is ready! Dispatch is being prepared.'
    case 'DISPATCHED':
      return 'Your scooter is on its way.'
    case 'DELIVERED':
      return 'Delivered. Thanks for choosing us.'

    case 'CANCELLED':
      return 'This case has been cancelled.'

    default:
      return 'Your repair is being processed.'
  }
}

/* ─── Notification trigger events ──────────────────────────────────── */

/** Map status → notification trigger event name (`null` = don't fire). */
export function triggerEventForStatus(status: string): string | null {
  switch (status) {
    case 'INBOUND_DIAGNOSIS':    return 'STATUS_CHANGE_INBOUND_DIAGNOSIS'
    case 'WAITING_FOR_MECHANIC': return 'STATUS_CHANGE_WAITING_FOR_MECHANIC'
    case 'IN_REPAIR':            return 'STATUS_CHANGE_IN_REPAIR'
    case 'AWAITING_PARTS':       return 'STATUS_CHANGE_AWAITING_PARTS'
    case 'CS_RECHARGE':          return 'STATUS_CHANGE_CS_RECHARGE'
    case 'READY_TO_SHIP':        return 'STATUS_CHANGE_READY_TO_SHIP'
    case 'DISPATCHED':           return 'STATUS_CHANGE_DISPATCHED'
    case 'DELIVERED':            return 'STATUS_CHANGE_DELIVERED'
    default:                     return null
  }
}

/** Short subject line for an email about a status change. */
export function notificationSubject(status: string): string {
  switch (status) {
    case 'INBOUND_DIAGNOSIS':    return 'Your scooter has arrived at the workshop'
    case 'WAITING_FOR_MECHANIC': return 'Your repair is queued'
    case 'IN_REPAIR':            return 'Repair in progress'
    case 'AWAITING_PARTS':       return 'We\'re waiting on parts'
    case 'CS_RECHARGE':          return 'Additional work needed on your scooter'
    case 'READY_TO_SHIP':        return 'Your scooter is ready'
    case 'DISPATCHED':           return 'Your scooter is on its way'
    case 'DELIVERED':            return 'Delivered — thanks for choosing us'
    default:                     return 'Update on your repair'
  }
}

/* ─── Timeline event mapping ───────────────────────────────────────── */

/** Customer-friendly description of a CaseStatusHistory transition. */
export type TimelineEvent = {
  message: string
  /** True for milestones the customer cares about — false ones are
   *  filtered out by the timeline serializer. */
  visible: boolean
}

export function timelineEvent(toStatus: string): TimelineEvent {
  switch (toStatus) {
    case 'NEW':
    case 'CS_TRIAGE':
      return { message: 'Booking received', visible: true }
    case 'AWAITING_INBOUND':
    case 'AWAITING_PICKUP':
    case 'IN_TRANSIT':
      return { message: 'Booking confirmed — we\'re ready to receive your scooter', visible: true }
    case 'INBOUND_DIAGNOSIS':
      return { message: 'Scooter received at our workshop', visible: true }
    case 'AWAITING_CS':
      return { message: 'Reviewing your repair', visible: true }
    case 'CS_RECHARGE':
      return { message: 'Additional work needed — we\'ll be in touch', visible: true }
    case 'CUSTOMER_DECLINED':
      return { message: 'Additional work declined', visible: true }
    case 'WAITING_FOR_MECHANIC':
      return { message: 'Queued for repair', visible: true }
    case 'IN_REPAIR':
      // The internal claim/start-repair endpoints both write to IN_REPAIR.
      // The serializer dedupes consecutive IN_REPAIR entries so the
      // customer only sees one "repair started" milestone.
      return { message: 'Repair started', visible: true }
    case 'AWAITING_PARTS':
      return { message: 'Waiting on parts', visible: true }
    case 'QC_FAILED':
      return { message: '', visible: false } // Hide the bounce.
    case 'QUALITY_CONTROL':
      return { message: 'Final quality check', visible: true }
    case 'READY_TO_SHIP':
      return { message: 'Quality check passed — preparing dispatch', visible: true }
    case 'DISPATCHED':
      return { message: 'Dispatched to you', visible: true }
    case 'DELIVERED':
      return { message: 'Delivered', visible: true }
    case 'DISPUTED':
      return { message: 'On hold — our team is reviewing', visible: true }
    case 'CANCELLED':
      return { message: 'Case cancelled', visible: true }
    default:
      return { message: '', visible: false }
  }
}

/* ─── ETA computation (Step 10) ────────────────────────────────────── */

/** Default warranty-case SLA in days from creation to dispatch. Mirrors
 *  the `SLA_TARGET_DAYS` constant in src/app/(dashboard)/reports/page.tsx —
 *  intentionally duplicated here to keep this file self-contained; if
 *  the value diverges, refactor both into src/lib/constants.ts. */
const SLA_TARGET_DAYS = 5

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Friday, 30 Apr" — manual format, no toLocaleString (hydration safe). */
function fmtDay(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** Compute a customer-facing ETA string. Always vague enough to give us
 *  buffer ("around Friday, 30 Apr") rather than committing to a time. */
export function estimatedCompletionLabel(args: {
  status:     string
  createdAt:  Date
  closedAt:   Date | null
}): string {
  const { status, createdAt, closedAt } = args

  if (status === 'DELIVERED') {
    if (closedAt) return `Delivered on ${fmtDay(closedAt)}`
    return 'Delivered'
  }
  if (status === 'CANCELLED' || status === 'CUSTOMER_DECLINED') {
    return 'Case closed'
  }
  if (status === 'AWAITING_PARTS') {
    return 'Pending parts arrival'
  }
  if (status === 'DISPATCHED') {
    return 'Within 2 days'
  }
  if (
    status === 'QUALITY_CONTROL' ||
    status === 'QUALITY_CHECK' ||
    status === 'READY_TO_SHIP'
  ) {
    return 'Within 24 hours'
  }

  // Default: createdAt + SLA_TARGET_DAYS, rounded forward to a weekday.
  const eta = new Date(createdAt.getTime() + SLA_TARGET_DAYS * 24 * 60 * 60 * 1000)
  // If ETA is in the past (busy queue, e.g. AWAITING_PARTS earlier),
  // show "Within a few days" instead of an awkward past date.
  if (eta.getTime() < Date.now()) return 'Within a few days'
  return `Around ${fmtDay(eta)}`
}
