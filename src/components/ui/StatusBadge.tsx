type Props = { status: string; type?: 'repair' | 'priority' | 'scooter' | 'case' | 'qc' | 'payment' }

const repairMap: Record<string, string> = {
  // Existing
  RECEIVED:             'badge-received',
  DIAGNOSING:           'badge-diagnosing',
  AWAITING_PARTS:       'badge-awaiting',
  IN_REPAIR:            'badge-repairing',
  QUALITY_CHECK:        'badge-quality',
  READY_TO_SHIP:        'badge-ready',
  DISPATCHED:           'badge-dispatched',
  CANCELLED:            'badge-cancelled',
  // New workflow
  AWAITING_INBOUND:     'badge-awaiting',
  AWAITING_CS:          'badge-awaiting-cs',
  WAITING_FOR_MECHANIC: 'badge-waiting-mech',
  DISPUTED:             'badge-disputed',
  QUALITY_CONTROL:      'badge-qc-control',
  QC_FAILED:            'badge-qc-failed',
  BGRADE_RECORDED:      'badge-bgrade',
}

const priorityMap: Record<string, string> = {
  URGENT: 'badge-urgent',
  HIGH:   'badge-high',
  NORMAL: 'badge-normal',
  LOW:    'badge-low',
}

const scooterMap: Record<string, string> = {
  IN_STOCK:              'badge-instock',
  WITH_CUSTOMER:         'badge-diagnosing',
  IN_REPAIR:             'badge-repairing',
  READY_TO_SHIP:         'badge-ready',
  DISPATCHED:            'badge-dispatched',
  SECOND_HAND_AVAILABLE: 'badge-available',
  SOLD:                  'badge-sold',
  WRITTEN_OFF:           'badge-written',
}

const caseMap: Record<string, string> = {
  WARRANTY: 'badge-warranty',
  BGRADE:   'badge-bgrade-t',
}

const qcMap: Record<string, string> = {
  PASS: 'badge-pass',
  FAIL: 'badge-fail',
  NA:   'badge-na',
}

const paymentMap: Record<string, string> = {
  PAID:              'badge-paid',
  UNPAID:            'badge-unpaid',
  DISPUTED:          'badge-disputed',
  WARRANTY_APPROVED: 'badge-warr-appr',
}

const LABELS: Record<string, string> = {
  AWAITING_INBOUND:     'Awaiting Inbound',
  AWAITING_CS:          'Awaiting CS',
  WAITING_FOR_MECHANIC: 'Waiting for Mechanic',
  BGRADE_RECORDED:      'B-Grade',
  QUALITY_CONTROL:      'QC',
  QC_FAILED:            'QC Failed',
  WARRANTY_APPROVED:    'Warranty Approved',
  NA:                   'N/A',
}

export default function StatusBadge({ status, type = 'repair' }: Props) {
  const map =
    type === 'priority' ? priorityMap :
    type === 'scooter'  ? scooterMap  :
    type === 'case'     ? caseMap     :
    type === 'qc'       ? qcMap       :
    type === 'payment'  ? paymentMap  :
    repairMap

  const cls   = map[status] ?? 'badge-normal'
  const label = LABELS[status] ?? status.replace(/_/g, ' ')
  return <span className={`badge ${cls}`}>{label}</span>
}
