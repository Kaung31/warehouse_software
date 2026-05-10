'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Btn from '@/components/ui/Btn'
import type { PaymentInfo } from '@/components/cases/PaymentInfoBanner'

/**
 * WorkshopClient — interactive bits of the /workshop page.
 *
 * Contains:
 *   - The "active job" card (live elapsed timer, payment one-liner,
 *     recharge alert, action buttons).
 *   - The "available queue" rows (claim buttons, FIFO + priority order).
 *
 * Server-side counts and the page chrome stay in /workshop/page.tsx so
 * this file stays focused on stateful UI.
 *
 * Patterns:
 *   - Per-button loading flags (claimingId / pauseBusy) — no shared `busy`.
 *   - On any successful mutation we router.refresh() to re-run the RSC.
 *   - Live timer ticks every 30s as spec'd (cheap; no perf concern).
 */

/* ─── Types (mirror server-component serialised shape) ───────────────── */

export type ActiveJob = {
  id:               string
  orderNumber:      string
  caseType:         'WARRANTY' | 'BGRADE'
  status:           string
  scooter: {
    brand:        string
    model:        string
    serialNumber: string
  }
  customerName:        string | null
  faultDescription:    string
  repairStartedAt:     string | null
  createdAt:           string
  rechargeReason:      string | null
  customerApprovedAt:  string | null
  payment:             PaymentInfo
}

export type QueueItem = {
  id:               string
  orderNumber:      string
  caseType:         'WARRANTY' | 'BGRADE'
  priority:         'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  scooter: {
    brand:        string
    model:        string
    serialNumber: string
  }
  faultDescription: string
  createdAt:        string
  /** Where the inbound team parked the scooter — pre-set when the case
   *  was first triaged, helps the mechanic walk straight to it. */
  locationLabel:    string | null
}

/** Cases the mechanic owns but that have left their active workspace
 *  (sent to CS for recharge / paused for parts / awaiting customer
 *  approval). Used by the "My cases in flight" panel so they keep
 *  visibility without hunting in /cases. */
export type InFlightCase = {
  id:                 string
  orderNumber:        string
  caseType:           'WARRANTY' | 'BGRADE'
  status:             string
  scooter: {
    brand:        string
    model:        string
    serialNumber: string
  }
  locationLabel:      string | null
  rechargeReason:     string | null
  customerApprovedAt: string | null
  updatedAt:          string
}

type Props = {
  activeJob:          ActiveJob | null
  queue:              QueueItem[]
  inFlight:           InFlightCase[]
  /** Used for nothing visible right now, but kept on the prop for parity
   *  with the eventual mechanic-name display in the active card.  */
  currentUserName:    string
  /** Show a busy-queue banner when queue.length exceeds this. */
  busyQueueThreshold: number
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

function elapsedLabel(fromIso: string, now: number): string {
  const ms   = now - new Date(fromIso).getTime()
  const mins = Math.max(0, Math.floor(ms / 60_000))
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** Condensed payment headline — single sentence the mechanic can scan
 *  at a glance. Mirrors the same priority chain as PaymentInfoBanner so
 *  both surfaces stay consistent. */
function paymentOneLiner(p: PaymentInfo): { text: string; tone: 'good' | 'amber' | 'red' | 'accent' | 'neutral' } {
  if (p.paymentStatus === 'DISPUTED') return { text: 'Payment disputed — hold work',           tone: 'red' }
  if (p.paymentStatus === 'REFUNDED') return { text: 'Customer refunded — case should close',  tone: 'red' }
  if (p.customerPrepaid)              return { text: 'Customer has paid — proceed',            tone: 'good' }
  if (p.paymentStatus === 'PAID')     return { text: 'Invoice paid',                           tone: 'good' }
  if (p.paymentStatus === 'WARRANTY_APPROVED') return { text: 'Warranty work — no charge',     tone: 'accent' }
  if (p.paymentStatus === 'PARTIAL')  return { text: 'Partial payment — recharge pending',     tone: 'amber' }
  if (p.warrantyConfirmed)            return { text: 'Warranty work — no charge',              tone: 'accent' }
  if (p.paymentStatus === 'UNPAID')   return { text: 'Not paid yet — confirm with CS',         tone: 'amber' }
  return                                       { text: 'Payment status unknown',               tone: 'neutral' }
}

/** SLA-style pill for queue rows. */
function ageTone(ageHours: number): '' | ' warn' | ' over' {
  if (ageHours >= 24) return ' over'
  if (ageHours >= 8)  return ' warn'
  return ''
}

/* ─── Component ──────────────────────────────────────────────────────── */

export default function WorkshopClient({
  activeJob,
  queue,
  inFlight,
  busyQueueThreshold,
}: Props) {
  const router = useRouter()

  /* Live tick — 30s as spec'd. Drives both the active card timer and
   * the queue "arrived Xh ago" labels. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  /* Per-row claim state. Keyed by case id so multiple rows can't share. */
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [claimError, setClaimError] = useState<string | null>(null)

  /* Pause-for-parts inline form. */
  const [showPauseForm, setShowPauseForm] = useState(false)
  const [partsNote,     setPartsNote]     = useState('')
  const [pauseBusy,     setPauseBusy]     = useState(false)
  const [pauseError,    setPauseError]    = useState<string | null>(null)

  async function claimCase(id: string) {
    setClaimingId(id)
    setClaimError(null)
    try {
      const res = await fetch(`/api/cases/${id}/claim`, { method: 'POST' })
      if (res.ok) {
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setClaimError(body.error ?? 'Failed to claim case')
      }
    } finally {
      setClaimingId(null)
    }
  }

  async function pauseForParts() {
    if (!activeJob) return
    setPauseBusy(true)
    setPauseError(null)
    try {
      const res = await fetch(`/api/cases/${activeJob.id}/awaiting-parts`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ partsNote: partsNote.trim() || undefined }),
      })
      if (res.ok) {
        setPartsNote('')
        setShowPauseForm(false)
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setPauseError(body.error ?? 'Failed to pause for parts')
      }
    } finally {
      setPauseBusy(false)
    }
  }

  /* ── Banner state ─────────────────────────────────────────────────
   * (a) Busy-queue banner when the available queue exceeds the
   *     threshold (default 10). The mechanic sees this every time they
   *     visit /workshop while the queue is busy — passive notification.
   * (b) Recharge-approved banner when the mechanic's active job has
   *     come back from CS with the customer's approval. Detected by
   *     having both rechargeReason and customerApprovedAt set on a case
   *     that's now in their hands. */
  const showBusyBanner =
    queue.length > busyQueueThreshold

  const showRechargeApprovedBanner =
    !!activeJob &&
    !!activeJob.rechargeReason &&
    !!activeJob.customerApprovedAt

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Banners ────────────────────────────────────────────── */}
      {showBusyBanner && (
        <div className="al al-i" style={{ margin: 0 }}>
          <BellIcon />
          <span>
            <strong>Busy queue.</strong>{' '}
            {queue.length} jobs waiting to be claimed — that&apos;s above the
            usual {busyQueueThreshold}. Pick the next one up when you&apos;re free.
          </span>
        </div>
      )}
      {showRechargeApprovedBanner && (
        <div className="al al-s" style={{ margin: 0 }}>
          <CheckIcon />
          <span>
            <strong>Recharge approved.</strong>{' '}
            <span className="mono">{activeJob.orderNumber}</span> is back from
            CS with the customer&apos;s sign-off — ready to resume.
          </span>
        </div>
      )}

      {/* ── Active job ──────────────────────────────────────────── */}
      {activeJob && (
        <ActiveJobCard
          job={activeJob}
          now={now}
          showPauseForm={showPauseForm}
          partsNote={partsNote}
          pauseBusy={pauseBusy}
          pauseError={pauseError}
          onTogglePause={() => {
            setShowPauseForm(s => !s)
            setPauseError(null)
          }}
          onPartsNoteChange={setPartsNote}
          onSubmitPause={pauseForParts}
        />
      )}

      {/* ── My cases in flight (sent to CS / paused for parts) ─── */}
      {inFlight.length > 0 && (
        <InFlightSection cases={inFlight} now={now} />
      )}

      {/* ── Available queue ─────────────────────────────────────── */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <h2 className="page-title" style={{ fontSize: 16 }}>
            Available to claim
          </h2>
          <span className="eyebrow" style={{ color: 'var(--sub)' }}>
            {queue.length} {queue.length === 1 ? 'job' : 'jobs'}
          </span>
        </div>

        {claimError && (
          <div className="al al-d" style={{ marginBottom: 10 }}>
            {claimError}
          </div>
        )}

        {queue.length === 0 ? (
          <EmptyQueue />
        ) : (
          <div className="row-grid">
            {queue.map(q => (
              <QueueRow
                key={q.id}
                item={q}
                now={now}
                disabled={!!activeJob}
                disabledReason={
                  activeJob
                    ? `Finish or pause your active job (${activeJob.orderNumber}) before claiming another.`
                    : ''
                }
                claiming={claimingId === q.id}
                onClaim={() => claimCase(q.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Active job card ────────────────────────────────────────────────── */

function ActiveJobCard({
  job,
  now,
  showPauseForm,
  partsNote,
  pauseBusy,
  pauseError,
  onTogglePause,
  onPartsNoteChange,
  onSubmitPause,
}: {
  job:               ActiveJob
  now:               number
  showPauseForm:     boolean
  partsNote:         string
  pauseBusy:         boolean
  pauseError:        string | null
  onTogglePause:     () => void
  onPartsNoteChange: (v: string) => void
  onSubmitPause:     () => void
}) {
  const startedAtIso = job.repairStartedAt ?? job.createdAt
  const elapsed      = elapsedLabel(startedAtIso, now)

  // SLA: warn if active for over 4h, over if 8h+. We don't have a real SLA
  // deadline yet; this is a sensible default and matches the spec's intent
  // ("amber if < 4h to deadline / red if breached").
  const ageMs    = now - new Date(startedAtIso).getTime()
  const ageHours = ageMs / 3_600_000
  const slaTone: '' | ' warn' | ' over' =
    ageHours >= 8 ? ' over' : ageHours >= 4 ? ' warn' : ''

  const payOneLiner = paymentOneLiner(job.payment)

  const showRechargeAlert =
    !!job.rechargeReason && !job.customerApprovedAt

  return (
    <div
      style={{
        background:    'var(--accent-dim)',
        border:        '1px solid transparent',
        borderRadius:  'var(--radius-lg)',
        padding:       18,
        display:       'flex',
        flexDirection: 'column',
        gap:           14,
        boxShadow:     'var(--card-sh)',
      }}
    >
      {/* Top row: type pill + scooter info + timer */}
      <div
        style={{
          display:        'flex',
          alignItems:     'flex-start',
          justifyContent: 'space-between',
          gap:            12,
          flexWrap:       'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TypePill caseType={job.caseType} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--accent-text)' }}>
              {job.orderNumber}
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            {job.scooter.brand} {job.scooter.model}{' '}
            <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: 'var(--sub)' }}>
              · {job.scooter.serialNumber}
            </span>
          </div>
          {job.faultDescription && (
            <div
              style={{
                fontSize:   13,
                color:      'var(--text)',
                lineHeight: 1.5,
                maxWidth:   720,
              }}
            >
              {job.faultDescription}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <span className={`tis${slaTone}`}>
            <ClockIcon /> Started {elapsed} ago
          </span>
        </div>
      </div>

      {/* Payment one-liner */}
      <div
        style={{
          display:      'flex',
          alignItems:   'center',
          gap:          8,
          fontSize:     12,
          fontWeight:   500,
          padding:      '8px 12px',
          borderRadius: 'var(--radius-md)',
          background:
            payOneLiner.tone === 'good'   ? 'var(--green-bg)'
            : payOneLiner.tone === 'amber'  ? 'var(--amber-bg)'
            : payOneLiner.tone === 'red'    ? 'var(--red-bg)'
            : payOneLiner.tone === 'accent' ? 'var(--blue-bg)'
                                            : 'var(--s2)',
          color:
            payOneLiner.tone === 'good'   ? 'var(--green-text)'
            : payOneLiner.tone === 'amber'  ? 'var(--amber-text)'
            : payOneLiner.tone === 'red'    ? 'var(--red-text)'
            : payOneLiner.tone === 'accent' ? 'var(--blue-text)'
                                            : 'var(--sub)',
        }}
      >
        <DotIcon />
        {payOneLiner.text}
      </div>

      {/* Recharge alert */}
      {showRechargeAlert && (
        <div className="al al-w" style={{ margin: 0 }}>
          <strong>Awaiting customer approval.</strong>{' '}
          Don&apos;t proceed with the part: {job.rechargeReason}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Link href={`/workshop/job/${job.id}`}>
          <Btn variant="primary">Continue</Btn>
        </Link>
        <Btn variant="warning" onClick={onTogglePause} disabled={pauseBusy}>
          {showPauseForm ? 'Cancel pause' : 'Pause for parts'}
        </Btn>
        <Link href={`/workshop/job/${job.id}`}>
          <Btn variant="success">Done — send to QC</Btn>
        </Link>
      </div>

      {/* Inline pause-for-parts form */}
      {showPauseForm && (
        <div
          style={{
            display:       'flex',
            flexDirection: 'column',
            gap:           8,
            padding:       12,
            border:        '1px solid var(--amber-b)',
            background:    'var(--amber-bg)',
            borderRadius:  'var(--radius-md)',
          }}
        >
          <label
            className="eyebrow"
            style={{ color: 'var(--amber-text)' }}
            htmlFor="parts-note"
          >
            What part(s) are you waiting on?
          </label>
          <input
            id="parts-note"
            type="text"
            placeholder="e.g. front brake caliper — eta Tuesday"
            value={partsNote}
            onChange={(e) => onPartsNoteChange(e.target.value)}
            disabled={pauseBusy}
            style={{ fontSize: 13 }}
          />
          {pauseError && (
            <div style={{ fontSize: 12, color: 'var(--red-text)' }}>{pauseError}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn
              variant="warning"
              loading={pauseBusy}
              onClick={onSubmitPause}
            >
              Confirm pause
            </Btn>
          </div>
          <div style={{ fontSize: 11, color: 'var(--amber-text)', opacity: 0.85 }}>
            This case will leave your queue and become claimable again once parts
            arrive and the warehouse reopens it.
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Queue row ──────────────────────────────────────────────────────── */

function QueueRow({
  item,
  now,
  disabled,
  disabledReason,
  claiming,
  onClaim,
}: {
  item:           QueueItem
  now:            number
  disabled:       boolean
  disabledReason: string
  claiming:       boolean
  onClaim:        () => void
}) {
  const ageMs    = now - new Date(item.createdAt).getTime()
  const ageHours = ageMs / 3_600_000
  const tone     = ageTone(ageHours)
  const arrived  = elapsedLabel(item.createdAt, now)

  return (
    <div
      style={{
        display:        'grid',
        // Type pill / scooter / fault / location / arrived / claim button
        gridTemplateColumns: 'auto 1.5fr 1fr auto auto 130px',
        gap:            16,
        alignItems:     'center',
        padding:        '14px 18px',
        borderBottom:   '1px solid var(--border)',
      }}
    >
      <TypePill caseType={item.caseType} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {item.scooter.brand} {item.scooter.model}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--sub)' }}>
          {item.scooter.serialNumber} · {item.orderNumber}
        </div>
      </div>
      <div
        style={{
          fontSize:     12,
          color:        'var(--sub)',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
        title={item.faultDescription}
      >
        {item.faultDescription}
      </div>
      <div>
        {item.locationLabel ? (
          <span
            className="mono"
            style={{
              fontSize:    11,
              fontWeight:  500,
              color:       'var(--accent-text)',
              background:  'var(--accent-dim)',
              padding:     '3px 9px',
              borderRadius:999,
              display:     'inline-flex',
              alignItems:  'center',
              gap:         4,
              whiteSpace:  'nowrap',
            }}
            title="Where the inbound team parked it"
          >
            <PinIcon />
            {item.locationLabel}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            no location
          </span>
        )}
      </div>
      <div>
        <span className={`tis${tone}`}>
          <ClockIcon /> Arrived {arrived} ago
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Btn
          variant="primary"
          size="sm"
          loading={claiming}
          disabled={disabled}
          title={disabled ? disabledReason : 'Claim this job'}
          onClick={onClaim}
        >
          Claim
        </Btn>
      </div>
    </div>
  )
}

function EmptyQueue() {
  return (
    <div
      style={{
        background:    'var(--surface)',
        border:        '1px dashed var(--border)',
        borderRadius:  'var(--radius-lg)',
        padding:       28,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           10,
        color:         'var(--sub)',
      }}
    >
      <div
        style={{
          width:          36,
          height:         36,
          borderRadius:   '50%',
          background:     'var(--green-bg)',
          color:          'var(--green-text)',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
        }}
      >
        <CheckIcon />
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
        Queue is clear
      </div>
      <div style={{ fontSize: 12 }}>
        Nothing waiting for a mechanic right now.
      </div>
    </div>
  )
}

/* ─── Bits ───────────────────────────────────────────────────────────── */

function TypePill({ caseType }: { caseType: 'WARRANTY' | 'BGRADE' }) {
  const isB = caseType === 'BGRADE'
  return (
    <span
      style={{
        fontSize:       10,
        fontWeight:     600,
        textTransform:  'uppercase',
        letterSpacing:  '.06em',
        padding:        '3px 8px',
        borderRadius:   999,
        background:     isB ? 'var(--amber-bg)' : 'var(--accent-dim)',
        color:          isB ? 'var(--amber-text)' : 'var(--accent-text)',
        whiteSpace:     'nowrap',
      }}
    >
      {isB ? 'B-grade' : 'Warranty'}
    </span>
  )
}

function ClockIcon() {
  return (
    <svg
      width={11} height={11} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function DotIcon() {
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="3" fill="currentColor" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width={18} height={18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      width={10} height={10} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg
      width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

/* ─── In-flight cases section ────────────────────────────────────────── */

function InFlightSection({
  cases,
  now,
}: {
  cases: InFlightCase[]
  now:   number
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h2 className="page-title" style={{ fontSize: 16 }}>
          My cases in flight
        </h2>
        <span className="eyebrow" style={{ color: 'var(--sub)' }}>
          {cases.length} {cases.length === 1 ? 'case' : 'cases'}
        </span>
      </div>
      <div className="row-grid">
        {cases.map((c) => (
          <InFlightRow key={c.id} item={c} now={now} />
        ))}
      </div>
    </div>
  )
}

function InFlightRow({ item, now }: { item: InFlightCase; now: number }) {
  const status = inFlightStatusLabel(item)
  const since  = elapsedLabel(item.updatedAt, now)

  return (
    <div
      style={{
        display:        'grid',
        // Type / scooter / status / location / age / open
        gridTemplateColumns: 'auto 1.4fr 1.2fr auto auto 90px',
        gap:            16,
        alignItems:     'center',
        padding:        '12px 18px',
        borderBottom:   '1px solid var(--border)',
      }}
    >
      <TypePill caseType={item.caseType} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {item.scooter.brand} {item.scooter.model}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--sub)' }}>
          {item.scooter.serialNumber} · {item.orderNumber}
        </div>
      </div>
      <div>
        <span
          style={{
            display:      'inline-flex',
            alignItems:   'center',
            gap:          5,
            fontSize:     11,
            fontWeight:   500,
            padding:      '3px 9px',
            borderRadius: 999,
            background:   status.bg,
            color:        status.text,
          }}
        >
          {status.label}
        </span>
      </div>
      <div>
        {item.locationLabel ? (
          <span
            className="mono"
            style={{
              fontSize:    11,
              fontWeight:  500,
              color:       'var(--accent-text)',
              background:  'var(--accent-dim)',
              padding:     '3px 9px',
              borderRadius:999,
              display:     'inline-flex',
              alignItems:  'center',
              gap:         4,
              whiteSpace:  'nowrap',
            }}
          >
            <PinIcon />
            {item.locationLabel}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            no location
          </span>
        )}
      </div>
      <span style={{ fontSize: 11, color: 'var(--sub)' }}>
        Updated {since} ago
      </span>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          href={item.caseType === 'BGRADE' ? `/b-grade/${item.id}` : `/cases/${item.id}`}
          style={{
            fontSize:      12,
            fontWeight:    500,
            color:         'var(--accent-text)',
            textDecoration:'none',
          }}
        >
          View →
        </Link>
      </div>
    </div>
  )
}

/** Map an in-flight case status to the row pill copy and tone. */
function inFlightStatusLabel(c: InFlightCase): {
  label: string
  bg:    string
  text:  string
} {
  if (c.status === 'AWAITING_PARTS') {
    return {
      label: 'Paused — awaiting parts',
      bg:    'var(--amber-bg)',
      text:  'var(--amber-text)',
    }
  }
  if (c.status === 'CS_RECHARGE') {
    return {
      label: 'CS recharging customer',
      bg:    'var(--blue-bg)',
      text:  'var(--blue-text)',
    }
  }
  if (c.status === 'AWAITING_CS') {
    if (c.customerApprovedAt) {
      return {
        label: 'Approved — coming back',
        bg:    'var(--green-bg)',
        text:  'var(--green-text)',
      }
    }
    return {
      label: c.rechargeReason ? 'Sent to CS for recharge' : 'With CS',
      bg:    'var(--blue-bg)',
      text:  'var(--blue-text)',
    }
  }
  return { label: c.status, bg: 'var(--s2)', text: 'var(--sub)' }
}
