'use client'

/**
 * PaymentInfoBanner — shows payment / warranty / invoice status to the
 * inbound and mechanic teams.
 *
 * Uses ONLY existing schema fields (no migration needed):
 *   - customerPrepaid       (boolean): did customer pay before arrival?
 *   - csPaymentNote         (string):  CS notes on what was paid for
 *   - warrantyConfirmed     (boolean): scooter is confirmed under warranty
 *   - quoteAmount           (decimal): initial quote (if any)
 *   - quotedAt              (date):    when quote was sent
 *   - quoteApprovedAt       (date):    when customer approved
 *   - rechargeAmount        (decimal): extra charge amount (if any)
 *   - rechargeReason        (string):  why recharge was needed
 *   - customerApprovedAt    (date):    when customer approved the recharge
 *   - invoice.paymentStatus (enum):    PAID|UNPAID|DISPUTED|WARRANTY_APPROVED|PARTIAL|REFUNDED
 *   - invoice.invoiceNumber (string):  invoice reference
 *
 * Decision tree (top to bottom — first match wins for the headline):
 *   1. paymentStatus = DISPUTED     → red banner ("Payment disputed")
 *   2. paymentStatus = REFUNDED     → red banner ("Refunded — case closed")
 *   3. customerPrepaid = true       → green banner with what they paid for
 *   4. paymentStatus = PAID         → green banner with invoice ref
 *   5. paymentStatus = WARRANTY_APPROVED → blue banner ("Warranty covers")
 *   6. paymentStatus = PARTIAL      → amber banner ("Partial — recharge pending")
 *   7. warrantyConfirmed = true     → blue banner ("Warranty work")
 *   8. paymentStatus = UNPAID       → amber banner ("Not paid yet — confirm with CS")
 *
 * Below the headline, optional rows show:
 *   - Initial quote (if quoteAmount set)
 *   - Recharge details (if rechargeAmount set)
 *   - Warranty status chip
 *
 * Usage in InboundPanel / MechanicPanel:
 *   <PaymentInfoBanner data={paymentDataFromCase(repairOrder)} />
 */

type Status =
  | 'paid_prepaid'    // customerPrepaid=true
  | 'paid_invoice'    // invoice.paymentStatus = PAID
  | 'warranty'        // WARRANTY_APPROVED or warrantyConfirmed=true
  | 'partial'         // PARTIAL
  | 'unpaid'          // UNPAID
  | 'disputed'        // DISPUTED
  | 'refunded'        // REFUNDED
  | 'unknown'         // no info yet

export type PaymentInfo = {
  customerPrepaid: boolean
  csPaymentNote: string | null
  warrantyConfirmed: boolean
  quoteAmount: number | null
  quotedAt: Date | string | null
  quoteApprovedAt: Date | string | null
  rechargeAmount: number | null
  rechargeReason: string | null
  customerApprovedAt: Date | string | null
  invoiceNumber: string | null
  paymentStatus:
    | 'PAID'
    | 'UNPAID'
    | 'DISPUTED'
    | 'WARRANTY_APPROVED'
    | 'PARTIAL'
    | 'REFUNDED'
    | null
}

type Theme = {
  bg: string
  border: string
  text: string
  iconBg: string
  iconColor: string
  label: string
  subtitle: string
}

const THEMES: Record<Status, Theme> = {
  paid_prepaid: {
    bg: 'var(--green-bg)',
    border: 'var(--green-b)',
    text: 'var(--green-text)',
    iconBg: 'var(--green)',
    iconColor: '#fff',
    label: 'Customer has already paid',
    subtitle: 'Proceed with the work below',
  },
  paid_invoice: {
    bg: 'var(--green-bg)',
    border: 'var(--green-b)',
    text: 'var(--green-text)',
    iconBg: 'var(--green)',
    iconColor: '#fff',
    label: 'Invoice paid',
    subtitle: 'Customer payment confirmed',
  },
  warranty: {
    bg: 'var(--accent-dim)',
    border: 'transparent',
    text: 'var(--accent-text)',
    iconBg: 'var(--accent)',
    iconColor: '#fff',
    label: 'Warranty work',
    subtitle: 'Covered by warranty — no charge to customer',
  },
  partial: {
    bg: 'var(--amber-bg)',
    border: 'var(--amber-b)',
    text: 'var(--amber-text)',
    iconBg: 'var(--amber)',
    iconColor: '#fff',
    label: 'Partial payment received',
    subtitle: 'Customer paid initial quote — recharge may be pending',
  },
  unpaid: {
    bg: 'var(--amber-bg)',
    border: 'var(--amber-b)',
    text: 'var(--amber-text)',
    iconBg: 'var(--amber)',
    iconColor: '#fff',
    label: 'Payment not confirmed',
    subtitle: 'Confirm with CS before starting work',
  },
  disputed: {
    bg: 'var(--red-bg)',
    border: 'var(--red-b)',
    text: 'var(--red-text)',
    iconBg: 'var(--red)',
    iconColor: '#fff',
    label: 'Payment disputed',
    subtitle: 'Hold work — CS needs to resolve dispute first',
  },
  refunded: {
    bg: 'var(--red-bg)',
    border: 'var(--red-b)',
    text: 'var(--red-text)',
    iconBg: 'var(--red)',
    iconColor: '#fff',
    label: 'Customer refunded',
    subtitle: 'Case should be closed — do not proceed',
  },
  unknown: {
    bg: 'var(--s2)',
    border: 'var(--border)',
    text: 'var(--sub)',
    iconBg: 'var(--text-faint)',
    iconColor: '#fff',
    label: 'No payment information',
    subtitle: 'Check with CS team',
  },
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDate(d: Date | string): string {
  const date = new Date(d)
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

function formatMoney(n: number | null): string {
  if (n == null) return ''
  return `£${Number(n).toFixed(2)}`
}

/** Determine which status to show as the headline */
function determineStatus(d: PaymentInfo): Status {
  if (d.paymentStatus === 'DISPUTED') return 'disputed'
  if (d.paymentStatus === 'REFUNDED') return 'refunded'
  if (d.customerPrepaid) return 'paid_prepaid'
  if (d.paymentStatus === 'PAID') return 'paid_invoice'
  if (d.paymentStatus === 'WARRANTY_APPROVED') return 'warranty'
  if (d.paymentStatus === 'PARTIAL') return 'partial'
  if (d.warrantyConfirmed) return 'warranty'
  if (d.paymentStatus === 'UNPAID') return 'unpaid'
  return 'unknown'
}


export default function PaymentInfoBanner({ data }: { data: PaymentInfo }) {
  const status = determineStatus(data)
  const theme = THEMES[status]
  const showWhatPaidFor =
    (status === 'paid_prepaid' || status === 'paid_invoice') &&
    data.csPaymentNote?.trim()
  const showQuote = data.quoteAmount != null
  const showRecharge = data.rechargeAmount != null && data.rechargeReason
  const showWarrantyChip = data.warrantyConfirmed && status !== 'warranty'

  return (
    <div
      style={{
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 14,
      }}
    >
      {/* Headline: icon + status label + subtitle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: theme.iconBg,
            color: theme.iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <StatusIcon status={status} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              color: theme.text,
              opacity: 0.75,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Payment status
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: theme.text,
              lineHeight: 1.3,
            }}
          >
            {theme.label}
            {data.invoiceNumber && (
              <span
                className="mono"
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  opacity: 0.7,
                }}
              >
                #{data.invoiceNumber}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: theme.text,
              opacity: 0.85,
              marginTop: 3,
              lineHeight: 1.4,
            }}
          >
            {theme.subtitle}
          </div>
        </div>
        {showWarrantyChip && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 999,
              background: 'var(--accent-dim)',
              color: 'var(--accent-text)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <ShieldIcon size={11} />
            Warranty confirmed
          </span>
        )}
      </div>

      {/* What they paid for */}
      {showWhatPaidFor && (
        <DetailBlock
          label="What they paid for"
          value={data.csPaymentNote!.trim()}
          theme={theme}
        />
      )}

      {/* Initial quote */}
      {showQuote && (
        <DetailBlock
          label="Initial quote"
          theme={theme}
          value={
            <span>
              <strong>{formatMoney(data.quoteAmount)}</strong>
              {data.quotedAt && (
                <span style={{ opacity: 0.7, fontWeight: 400 }}>
                  {' '}
                  · sent {formatDate(data.quotedAt)}
                </span>
              )}
              {data.quoteApprovedAt && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--green-text)',
                    background: 'var(--green-bg)',
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--green-b)',
                  }}
                >
                  ✓ Approved {formatDate(data.quoteApprovedAt)}
                </span>
              )}
            </span>
          }
        />
      )}

      {/* Recharge */}
      {showRecharge && (
        <DetailBlock
          label="Additional charge"
          theme={theme}
          value={
            <div>
              <div>
                <strong>{formatMoney(data.rechargeAmount)}</strong>
                {data.customerApprovedAt ? (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--green-text)',
                      background: 'var(--green-bg)',
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: '1px solid var(--green-b)',
                    }}
                  >
                    ✓ Approved {formatDate(data.customerApprovedAt)}
                  </span>
                ) : (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--amber-text)',
                      background: 'var(--amber-bg)',
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: '1px solid var(--amber-b)',
                    }}
                  >
                    Awaiting approval
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  marginTop: 4,
                  opacity: 0.85,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {data.rechargeReason}
              </div>
            </div>
          }
        />
      )}
    </div>
  )
}


/** Dividerless detail block matching the banner theme */
function DetailBlock({
  label,
  value,
  theme,
}: {
  label: string
  value: React.ReactNode
  theme: Theme
}) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: `1px solid ${theme.border === 'transparent' ? 'rgba(0,0,0,0.06)' : theme.border}`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: theme.text,
          opacity: 0.7,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          fontWeight: 600,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          color: theme.text,
          lineHeight: 1.5,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </div>
    </div>
  )
}


/* ─── Status icons ────────────────────────────────────────────────── */

function StatusIcon({ status }: { status: Status }) {
  const p = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (status) {
    case 'paid_prepaid':
    case 'paid_invoice':
      return (
        <svg {...p}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'warranty':
      return (
        <svg {...p}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      )
    case 'partial':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      )
    case 'unpaid':
      return (
        <svg {...p}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'disputed':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
    case 'refunded':
      return (
        <svg {...p}>
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      )
    case 'unknown':
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
  }
}

function ShieldIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}