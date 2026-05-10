/**
 * StatusBadge — renders a colored pill for any case/payment/QC status.
 *
 * v2 changes (April 2026):
 *   • Added new repair stages from workflow expansion:
 *       NEW, CS_TRIAGE, QUOTE_SENT, AWAITING_PICKUP, IN_TRANSIT,
 *       INBOUND_DIAGNOSIS, CS_RECHARGE, DELIVERED
 *   • Switched dot colors from hardcoded hex (#9d7cff etc.) to CSS
 *     variables (var(--purple) etc.) — auto-adapts to light/dark theme,
 *     stays consistent with globals.css palette
 *   • Comprehensive LABELS map — every status now has a Title Case label
 *     instead of falling back to "AWAITING_INBOUND" raw text
 *   • Added IN_TRANSIT / DELIVERED to scooterMap for inventory tracking
 *
 * Note: badge dots are HIDDEN in light mode by globals.css
 * ([data-theme="light"] .badge-dot { display: none }) — so they only
 * appear in dark mode where the bordered pill style benefits from
 * a status-color accent. Borderless light-mode pastels follow the
 * Puzzler reference design.
 */

type Props = {
  status: string
  type?: 'repair' | 'priority' | 'scooter' | 'case' | 'qc' | 'payment'
}

const repairMap: Record<string, [string, string]> = {
  // Pre-arrival stages (CS-owned)
  NEW:                   ['badge-awaiting-cs',       'var(--amber)'],
  CS_TRIAGE:             ['badge-cs-triage',         'var(--amber)'],
  QUOTE_SENT:            ['badge-quote-sent',        'var(--blue)'],
  AWAITING_PICKUP:       ['badge-quote-sent',        'var(--blue)'],
  IN_TRANSIT:            ['badge-in-transit',        'var(--blue)'],

  // Warehouse intake (Inbound now does diagnosis too)
  AWAITING_INBOUND:      ['badge-awaiting-inbound',  'var(--slate)'],
  INBOUND_DIAGNOSIS:     ['badge-inbound-diagnosis', 'var(--indigo)'],

  // CS review + recharge loops (back from Inbound or Mechanic)
  AWAITING_CS:           ['badge-awaiting-cs',       'var(--amber)'],
  CS_RECHARGE:           ['badge-cs-recharge',       'var(--red)'],
  DISPUTED:              ['badge-disputed',          'var(--red)'],

  // Mechanic stages
  WAITING_FOR_MECHANIC:  ['badge-waiting-mech',      'var(--blue)'],
  IN_REPAIR:             ['badge-in-repair',         'var(--purple)'],
  AWAITING_PARTS:        ['badge-awaiting-parts',    'var(--orange)'],

  // QC + dispatch
  QUALITY_CONTROL:       ['badge-qc',                'var(--teal)'],
  QC_FAILED:             ['badge-qc-failed',         'var(--red)'],
  READY_TO_SHIP:         ['badge-ready',             'var(--green)'],
  DISPATCHED:            ['badge-dispatched',        'var(--green)'],
  DELIVERED:             ['badge-delivered',         'var(--green)'],

  // Terminal states
  BGRADE_RECORDED:       ['badge-bgrade-recorded',   'var(--teal)'],
  CANCELLED:             ['badge-cancelled',         'var(--slate)'],

  // Legacy aliases (kept for backward compatibility)
  RECEIVED:              ['badge-received',          'var(--blue)'],
  DIAGNOSING:            ['badge-diagnosing',        'var(--purple)'],
  QUALITY_CHECK:         ['badge-qc',                'var(--teal)'],
}

const priorityMap: Record<string, [string, string]> = {
  URGENT: ['badge-urgent', 'var(--red)'],
  HIGH:   ['badge-high',   'var(--orange)'],
  NORMAL: ['badge-normal', 'var(--blue)'],
  LOW:    ['badge-low',    'var(--slate)'],
}

const scooterMap: Record<string, [string, string]> = {
  IN_STOCK:              ['badge-instock',    'var(--blue)'],
  WITH_CUSTOMER:         ['badge-diagnosing', 'var(--purple)'],
  IN_TRANSIT:            ['badge-in-transit', 'var(--blue)'],
  IN_REPAIR:             ['badge-in-repair',  'var(--purple)'],
  READY_TO_SHIP:         ['badge-ready',      'var(--green)'],
  DISPATCHED:            ['badge-dispatched', 'var(--green)'],
  DELIVERED:             ['badge-delivered',  'var(--green)'],
  SECOND_HAND_AVAILABLE: ['badge-available',  'var(--green)'],
  SOLD:                  ['badge-sold',       'var(--slate)'],
  WRITTEN_OFF:           ['badge-written',    'var(--red)'],
}

const caseMap: Record<string, [string, string]> = {
  WARRANTY: ['badge-warranty', 'var(--blue)'],
  BGRADE:   ['badge-bgrade',   'var(--amber)'],
}

const qcMap: Record<string, [string, string]> = {
  PASS: ['badge-pass', 'var(--green)'],
  FAIL: ['badge-fail', 'var(--red)'],
  NA:   ['badge-na',   'var(--slate)'],
}

const paymentMap: Record<string, [string, string]> = {
  PAID:              ['badge-paid',      'var(--green)'],
  UNPAID:            ['badge-unpaid',    'var(--red)'],
  DISPUTED:          ['badge-disputed',  'var(--red)'],
  WARRANTY_APPROVED: ['badge-warr-appr', 'var(--blue)'],
  REFUNDED:          ['badge-cancelled', 'var(--slate)'],
}

const LABELS: Record<string, string> = {
  // Repair stages
  NEW:                   'New',
  CS_TRIAGE:             'CS Triage',
  QUOTE_SENT:            'Quote Sent',
  AWAITING_PICKUP:       'Awaiting Pickup',
  IN_TRANSIT:            'In Transit',
  AWAITING_INBOUND:      'Awaiting Inbound',
  INBOUND_DIAGNOSIS:     'Inbound Diagnosis',
  AWAITING_CS:           'Awaiting CS',
  CS_RECHARGE:           'CS Recharge',
  WAITING_FOR_MECHANIC:  'Waiting — Mechanic',
  IN_REPAIR:             'In Repair',
  AWAITING_PARTS:        'Awaiting Parts',
  QUALITY_CONTROL:       'Quality Control',
  QC_FAILED:             'QC Failed',
  READY_TO_SHIP:         'Ready to Ship',
  DISPATCHED:            'Dispatched',
  DELIVERED:             'Delivered',
  BGRADE_RECORDED:       'B-Grade',
  DISPUTED:              'Disputed',
  CANCELLED:             'Cancelled',

  // Scooter
  IN_STOCK:              'In Stock',
  WITH_CUSTOMER:         'With Customer',
  SECOND_HAND_AVAILABLE: 'Available',
  SOLD:                  'Sold',
  WRITTEN_OFF:           'Written Off',

  // Case type
  WARRANTY:              'Warranty',
  BGRADE:                'B-Grade',

  // Priority
  URGENT:                'Urgent',
  HIGH:                  'High',
  NORMAL:                'Normal',
  LOW:                   'Low',

  // QC / payment
  PASS:                  'Pass',
  FAIL:                  'Fail',
  NA:                    'N/A',
  PAID:                  'Paid',
  UNPAID:                'Unpaid',
  WARRANTY_APPROVED:     'Warranty Approved',
  REFUNDED:              'Refunded',

  // Legacy aliases
  RECEIVED:              'Received',
  DIAGNOSING:            'Diagnosing',
  QUALITY_CHECK:         'Quality Check',
}

export default function StatusBadge({ status, type = 'repair' }: Props) {
  const map =
    type === 'priority' ? priorityMap :
    type === 'scooter'  ? scooterMap  :
    type === 'case'     ? caseMap     :
    type === 'qc'       ? qcMap       :
    type === 'payment'  ? paymentMap  :
    repairMap

  const [cls, dot] = map[status] ?? ['badge-low', 'var(--slate)']
  const label = LABELS[status] ?? status.replace(/_/g, ' ')

  return (
    <span className={`badge ${cls}`}>
      <span className="badge-dot" style={{ background: dot }} />
      {label}
    </span>
  )
}
