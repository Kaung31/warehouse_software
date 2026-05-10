'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * CSActionPanel — CS team's action panel on a case detail page.
 *
 * v2 changes (April 2026):
 *   • Removed the embedded comment composer — comments belong in
 *     CommentsThread (single source of truth). CS can still leave
 *     a payment note here (which lives on the case, not as a comment).
 *   • Replaced inline-style sections with .eyebrow + .ir / .ik / .iv
 *     and .card sub-blocks. No more inline-styled SectionTitle/Divider
 *     helpers.
 *   • Replaced the cramped layout with three clear sections:
 *       1. Triage decision (big buttons — Warranty / Paid / Info)
 *       2. Invoice & payment status
 *       3. Final decision (Approve / Dispute / Trigger Recharge)
 *   • Added "Trigger recharge" button — the new workflow path where
 *     CS, after looking at customer photos and details, decides the
 *     scope is bigger than originally quoted and needs to re-charge.
 *   • All emoji icons (✓) replaced with inline SVG.
 *   • Proper loading states using the new Btn `loading` prop.
 *   • Each action button shows its own loading spinner — no more
 *     "all buttons disabled while one is busy" behavior.
 *   • Customer-prepaid checkbox redesigned as a styled toggle row.
 *   • Payment status select uses native select but with refined label.
 *   • Quote builder placeholder block — "Build quote" button (disabled
 *     for now) marks where the PartsCatalogDrawer integration will land.
 *
 * NOTE: Backend still uses the existing /cs-update endpoint. The new
 * recharge / triage endpoints will be added in a later step.
 */

type Invoice = {
  invoiceNumber: string | null
  paymentStatus: string
}

type Recharge = {
  origin: 'INBOUND_DIAGNOSIS' | 'MECHANIC_REPAIR'
  reason: string
  requestedAt: string | null
}

type Props = {
  caseId: string
  status: string
  invoice: Invoice | null
  customerPrepaid: boolean
  csPaymentNote: string | null
  recharge?: Recharge | null
}

const PAYMENT_OPTIONS = [
  { value: 'PAID',              label: 'Paid' },
  { value: 'PARTIAL',           label: 'Partially paid' },
  { value: 'UNPAID',            label: 'Unpaid' },
  { value: 'WARRANTY_APPROVED', label: 'Warranty approved' },
  { value: 'DISPUTED',          label: 'Disputed' },
  { value: 'REFUNDED',          label: 'Refunded' },
]

const ORIGIN_LABELS: Record<Recharge['origin'], string> = {
  INBOUND_DIAGNOSIS: 'inbound team',
  MECHANIC_REPAIR: 'mechanic',
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDateTime(d: string): string {
  const date = new Date(d)
  const day = date.getDate()
  const month = MONTHS[date.getMonth()]
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${hh}:${mm}`
}


export default function CSActionPanel({
  caseId,
  status,
  invoice,
  customerPrepaid: initPrepaid,
  csPaymentNote: initNote,
  recharge,
}: Props) {
  const router = useRouter()

  const [paymentStatus, setPaymentStatus] = useState(
    invoice?.paymentStatus ?? 'UNPAID'
  )
  const [prepaid, setPrepaid] = useState(initPrepaid)
  const [paymentNote, setPaymentNote] = useState(initNote ?? '')

  // Per-button loading flags so multiple actions don't share state
  const [savingNote, setSavingNote] = useState(false)
  const [approving, setApproving] = useState(false)
  const [disputing, setDisputing] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  const [linkResult, setLinkResult] = useState<string | null>(null)
  const [error, setError] = useState('')

  /* Phase B — Send tracking link button. Posts to the CS-only endpoint
   * which generates a fresh 1-hour token and dispatches an email/SMS to
   * the customer (audit row written either way). */
  async function sendTrackingLink() {
    setSendingLink(true)
    setError('')
    setLinkResult(null)
    try {
      const res = await fetch(`/api/cases/${caseId}/send-tracking-link`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        const channels = (body?.data?.sentChannels ?? []) as string[]
        setLinkResult(
          channels.length > 0
            ? `Tracking link sent via ${channels.join(' + ')}.`
            : 'Tracking link queued.',
        )
      } else {
        setError(body.error ?? 'Failed to send tracking link.')
      }
    } catch {
      setError('Network error while sending tracking link.')
    } finally {
      setSendingLink(false)
    }
  }

  async function send(
    extra: object,
    setBusy: (b: boolean) => void
  ): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        ...extra,
        paymentStatus,
        customerPrepaid: prepaid,
        csPaymentNote: paymentNote.trim() || undefined,
      }
      const res = await fetch(`/api/cases/${caseId}/cs-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        router.refresh()
        return true
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to save')
        return false
      }
    } catch {
      setError('Network error — please try again')
      return false
    } finally {
      setBusy(false)
    }
  }

  const isAwaitingDecision =
    status === 'AWAITING_CS' || status === 'DISPUTED'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ─── Title ─── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          CS action panel
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          {recharge
            ? 'Recharge requested — review and re-quote the customer'
            : status === 'AWAITING_CS'
            ? 'Review payment, then approve or dispute'
            : status === 'DISPUTED'
            ? 'Resolve dispute or escalate'
            : 'Update case info'}
        </div>
      </div>

      {/* ─── Recharge alert (Bug 3 fix) ───
          Shown when inbound or mechanic flagged additional scope.
          Replaces the previous placeholder "coming in next update" copy
          with the actual rechargeReason / origin / requestedAt from the DB. */}
      {recharge && (
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--orange-bg)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--orange-b)',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--orange)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <RefreshIcon />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--orange-text)',
                opacity: 0.75,
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              Recharge requested
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--orange-text)',
                marginBottom: 6,
              }}
            >
              The {ORIGIN_LABELS[recharge.origin]} found additional scope
              that needs re-quoting
              {recharge.requestedAt && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 400,
                    opacity: 0.7,
                  }}
                >
                  · {formatDateTime(recharge.requestedAt)}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--orange-text)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'rgba(255,255,255,0.5)',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid var(--orange-b)',
              }}
            >
              {recharge.reason}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--orange-text)',
                opacity: 0.8,
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              Build a new quote with the customer (call / email),
              update the payment note below, then approve to send back
              to the {ORIGIN_LABELS[recharge.origin]}.
            </div>
          </div>
        </div>
      )}

      {/* ─── Invoice & payment ─── */}
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--s2)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Invoice number
        </div>
        <div
          className="mono"
          style={{
            fontSize: 13,
            color: invoice?.invoiceNumber
              ? 'var(--text)'
              : 'var(--text-faint)',
          }}
        >
          {invoice?.invoiceNumber ?? 'Not provided'}
        </div>
      </div>

      <div>
        <label htmlFor="payment-status">Payment status</label>
        <select
          id="payment-status"
          value={paymentStatus}
          onChange={e => setPaymentStatus(e.target.value)}
          disabled={savingNote || approving || disputing}
        >
          {PAYMENT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* ─── Customer pre-payment ─── */}
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--s2)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }}
      >
        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            marginBottom: 0,
            cursor: 'pointer',
            textTransform: 'none',
            letterSpacing: 0,
            color: 'var(--text)',
            fontWeight: 400,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={prepaid}
            onChange={e => setPrepaid(e.target.checked)}
            style={{ width: 'auto', marginBottom: 0, marginTop: 2 }}
            disabled={savingNote || approving || disputing}
          />
          <span>
            <span style={{ fontWeight: 500 }}>Customer has pre-paid</span>
            <div
              style={{
                fontSize: 11,
                color: 'var(--sub)',
                marginTop: 2,
              }}
            >
              Customer paid before sending the scooter (e.g. paid online when
              reporting the fault).
            </div>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="payment-note">Payment notes</label>
        <textarea
          id="payment-note"
          rows={3}
          value={paymentNote}
          onChange={e => setPaymentNote(e.target.value)}
          placeholder="e.g. Customer paid £80 for labour + brake cable on 2026-04-20"
          style={{ resize: 'vertical' }}
          disabled={savingNote || approving || disputing}
        />
      </div>

      {/* ─── Save button ─── */}
      <Btn
        variant="secondary"
        size="sm"
        loading={savingNote}
        disabled={approving || disputing}
        onClick={() => send({}, setSavingNote)}
      >
        Save payment info
      </Btn>

      {/* ─── Decision (only when waiting on CS) ─── */}
      {isAwaitingDecision && (
        <>
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: 16,
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Decision
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <Btn
                variant="success"
                size="lg"
                loading={approving}
                disabled={savingNote || disputing}
                onClick={async () => {
                  await send({ approveForMechanic: true }, setApproving)
                }}
                iconLeft={<CheckIcon />}
              >
                Approve — send to mechanic
              </Btn>
              <Btn
                variant="danger"
                size="sm"
                loading={disputing}
                disabled={savingNote || approving}
                onClick={async () => {
                  await send({ markDisputed: true }, setDisputing)
                }}
                iconLeft={<AlertIcon />}
              >
                Flag as disputed
              </Btn>
            </div>
          </div>

          {/* Recharge alert moved to the top of the panel (Bug 3 fix).
              When recharge data is present, the alert at the top shows
              the actual reason / origin / timestamp from the DB. */}
        </>
      )}

      {/* Phase B — manual tracking-link send. Always available so CS
          can re-share a link after the auto one expires. */}
      <div
        style={{
          borderTop:  '1px solid var(--border)',
          paddingTop: 16,
          display:    'flex',
          flexDirection: 'column',
          gap:        8,
        }}
      >
        <div className="eyebrow">Customer tracking</div>
        <Btn
          variant="secondary"
          size="sm"
          loading={sendingLink}
          disabled={savingNote || approving || disputing}
          onClick={sendTrackingLink}
          iconLeft={<LinkIcon />}
        >
          Send tracking link
        </Btn>
        <div style={{ fontSize: 11, color: 'var(--sub)' }}>
          Emails (or SMSes) the customer a private link valid for one hour.
        </div>
        {linkResult && (
          <div className="al al-s" style={{ margin: 0 }}>
            {linkResult}
          </div>
        )}
      </div>

      {error && <div className="al al-d" style={{ marginBottom: 0 }}>{error}</div>}
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1 4 1 10 7 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}