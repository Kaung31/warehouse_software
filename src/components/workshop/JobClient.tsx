'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import PaymentInfoBanner, { type PaymentInfo } from '@/components/cases/PaymentInfoBanner'
import CasePhotos from '@/components/cases/CasePhotos'
import JobPartsPanel, { type JobRepairPart, type CompatiblePart } from './JobPartsPanel'
import JobNotes from './JobNotes'
import JobActionBar from './JobActionBar'
import JobGuidePicker, { type GuideOption } from './JobGuidePicker'
import JobTimer from './JobTimer'

/**
 * JobClient — the mechanic's repair workspace shell.
 *
 * Renders the entire /workshop/job/[id] page. Sub-sections live in their
 * own client components to keep this file focused on layout and the
 * shared elapsed-timer state.
 *
 * Phase A v2 changes (May 2026):
 *   - Sticky top bar shows scooter location.
 *   - "Customer fault" → "Customer's complaint".
 *   - Inbound photos collapsed by default behind a Show/Hide toggle.
 *   - Repair tasks card replaced with a model-specific RepairGuide picker
 *     that links into /repair-guides/[id]. The strict task-based
 *     completion gate is gone; mark-complete is enabled while the case
 *     is IN_REPAIR.
 *   - Parts panel gains a "Compatible parts for <model>" list with bin
 *     locations and live stock from the catalog.
 *   - New JobTimer card with stop/restart for break time.
 *
 * The CaseTask schema and /api/cases/[id]/tasks endpoints stay in
 * place but aren't surfaced in the mechanic UI any more.
 */

export type Job = {
  id:                string
  orderNumber:       string
  caseType:          'WARRANTY' | 'BGRADE'
  status:            string
  scooter: {
    brand:        string
    model:        string
    serialNumber: string
  }
  location: {
    /** First non-null of rackLocation, currentLocation.code, or .name. */
    label: string | null
    /** Long-form name for the tooltip. */
    name:  string | null
  }
  customerName:      string | null
  faultDescription:  string
  diagnosis:         string | null
  internalNotes:     string | null
  errorCodes:        string[]
  repairStartedAt:   string | null
  createdAt:         string
  rechargeReason:    string | null
  customerApprovedAt: string | null
  payment:           PaymentInfo
  repairParts:       JobRepairPart[]
  compatibleParts:   CompatiblePart[]
  guides:            GuideOption[]
}

type Props = {
  job: Job
  /** Kept on the prop signature for forward compat — formerly used by
   *  the read-only task list; the guide picker doesn't need it. */
  currentUserId?: string
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

function elapsedClock(fromIso: string | null, now: number): string {
  if (!fromIso) return '—'
  const ms   = Math.max(0, now - new Date(fromIso).getTime())
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/* ─── Component ──────────────────────────────────────────────────────── */

export default function JobClient({ job }: Props) {
  // Live timer — ticks every 30s. Drives the sticky top bar.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const elapsed = elapsedClock(job.repairStartedAt ?? job.createdAt, now)

  const hasInbound =
    !!job.diagnosis || job.errorCodes.length > 0 || !!job.internalNotes

  const showRechargeAlert =
    !!job.rechargeReason && !job.customerApprovedAt

  const partsCount = job.repairParts.length

  return (
    <div
      className="fade-up"
      style={{
        display:       'flex',
        flexDirection: 'column',
        gap:           14,
        // Leave room at the bottom so the sticky action bar doesn't cover
        // content. The bar is ~70px when collapsed but grows to ~190px
        // when the recharge form (a 2-row textarea) is open — give a
        // generous buffer so the last card never gets clipped.
        paddingBottom: 220,
        maxWidth:      900,
        margin:        '0 auto',
      }}
    >
      {/* ── Sticky top bar ───────────────────────────────────────── */}
      <div
        style={{
          position:       'sticky',
          top:            0,
          zIndex:         5,
          background:     'var(--surface)',
          border:         '1px solid var(--border)',
          borderRadius:   'var(--radius-lg)',
          padding:        '12px 16px',
          display:        'flex',
          alignItems:     'center',
          gap:            12,
          boxShadow:      'var(--card-sh)',
        }}
      >
        <Link
          href="/workshop"
          aria-label="Back to workshop"
          style={{
            display:       'inline-flex',
            alignItems:    'center',
            justifyContent:'center',
            width:         32,
            height:        32,
            borderRadius:  'var(--radius-md)',
            color:         'var(--text)',
            background:    'var(--s2)',
            textDecoration:'none',
          }}
        >
          <BackIcon />
        </Link>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--sub)' }}>
              {job.orderNumber}
            </span>
            <TypePill caseType={job.caseType} />
          </div>
          <div
            style={{
              fontSize:    14,
              fontWeight:  600,
              color:       'var(--text)',
              overflow:    'hidden',
              textOverflow:'ellipsis',
              whiteSpace:  'nowrap',
            }}
          >
            {job.scooter.brand} {job.scooter.model}{' '}
            <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: 'var(--sub)' }}>
              · {job.scooter.serialNumber}
            </span>
          </div>
        </div>
        {job.location.label && (
          <div
            className="mono"
            title={job.location.name ?? undefined}
            style={{
              fontSize:    12,
              fontWeight:  500,
              color:       'var(--accent-text)',
              display:     'inline-flex',
              alignItems:  'center',
              gap:         5,
              padding:     '5px 10px',
              background:  'var(--accent-dim)',
              borderRadius:'999px',
              whiteSpace:  'nowrap',
            }}
          >
            <PinIcon />
            {job.location.label}
          </div>
        )}
        <div
          className="mono"
          style={{
            fontSize:    13,
            color:       'var(--text)',
            display:     'inline-flex',
            alignItems:  'center',
            gap:         6,
            padding:     '6px 10px',
            background:  'var(--s2)',
            borderRadius:'999px',
          }}
        >
          <ClockIcon />
          Working: {elapsed}
        </div>
      </div>

      {/* ── Job summary ──────────────────────────────────────────── */}
      <Section title="Job summary">
        {job.customerName && (
          <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 6 }}>
            Customer: <span style={{ color: 'var(--text)', fontWeight: 500 }}>{job.customerName}</span>
          </div>
        )}
        <div className="eyebrow" style={{ marginBottom: 4 }}>Customer&apos;s complaint</div>
        <div
          style={{
            fontSize:   13,
            color:      'var(--text)',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}
        >
          {job.faultDescription}
        </div>
      </Section>

      {/* ── Inbound diagnosis (collapsible) ─────────────────────── */}
      {hasInbound && (
        <Collapsible title="Inbound diagnosis" defaultOpen>
          {job.diagnosis && (
            <>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Diagnosis</div>
              <div
                style={{
                  fontSize:   13,
                  color:      'var(--text)',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  marginBottom: 12,
                }}
              >
                {job.diagnosis}
              </div>
            </>
          )}

          {job.errorCodes.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Error codes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {job.errorCodes.map((ec) => (
                  <span
                    key={ec}
                    className="mono"
                    style={{
                      padding:     '3px 10px',
                      fontSize:    11,
                      fontWeight:  500,
                      border:      '1px solid var(--border)',
                      borderRadius:999,
                      background:  'var(--s2)',
                      color:       'var(--sub)',
                    }}
                  >
                    {ec}
                  </span>
                ))}
              </div>
            </>
          )}

          {job.internalNotes && (
            <>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Inbound notes</div>
              <div
                style={{
                  fontSize:   12,
                  color:      'var(--sub)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.55,
                  marginBottom: 12,
                }}
              >
                {job.internalNotes}
              </div>
            </>
          )}

          {/* Inbound photos — collapsed by default. CS / inbound often
              attach a stack of photos that the mechanic doesn't need to
              see at a glance, so they're behind a Show/Hide toggle. The
              gallery only fetches when the panel is opened, so closed
              jobs don't pay the network cost. */}
          <PhotosToggle caseId={job.id} />
        </Collapsible>
      )}

      {/* ── Payment info ─────────────────────────────────────────── */}
      <PaymentInfoBanner data={job.payment} />

      {/* ── Recharge alert ───────────────────────────────────────── */}
      {showRechargeAlert && (
        <div className="al al-w" style={{ margin: 0 }}>
          <strong>Awaiting customer approval —</strong>{' '}
          don&apos;t proceed with this part: {job.rechargeReason}
        </div>
      )}

      {/* ── Working timer (with stop/restart for breaks) ─────────── */}
      <JobTimer
        caseId={job.id}
        repairStartedAt={job.repairStartedAt}
      />

      {/* ── Repair guide picker (replaces the v1 task list) ──────── */}
      <JobGuidePicker
        caseId={job.id}
        scooterBrand={job.scooter.brand}
        scooterModel={job.scooter.model}
        guides={job.guides}
      />

      {/* ── Parts used ───────────────────────────────────────────── */}
      <JobPartsPanel
        caseId={job.id}
        parts={job.repairParts}
        compatibleParts={job.compatibleParts}
        scooterModel={job.scooter.model}
      />

      {/* ── Mechanic notes ───────────────────────────────────────── */}
      <JobNotes
        caseId={job.id}
        initialNotes={job.internalNotes ?? ''}
      />

      {/* ── Sticky bottom action bar ─────────────────────────────── */}
      <JobActionBar
        caseId={job.id}
        status={job.status}
        orderNumber={job.orderNumber}
        caseDiagnosis={job.diagnosis}
        partsCount={partsCount}
      />
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background:    'var(--surface)',
        border:        '1px solid var(--border)',
        borderRadius:  'var(--radius-lg)',
        padding:       '16px 18px',
        boxShadow:     'var(--card-sh)',
      }}
    >
      <div
        className="eyebrow"
        style={{ marginBottom: 8, color: 'var(--text)', opacity: 0.7 }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title:       string
  defaultOpen?:boolean
  children:    React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      style={{
        background:    'var(--surface)',
        border:        '1px solid var(--border)',
        borderRadius:  'var(--radius-lg)',
        boxShadow:     'var(--card-sh)',
        overflow:      'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          all:           'unset',
          width:         '100%',
          padding:       '14px 18px',
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
          cursor:        'pointer',
          color:         'var(--text)',
        }}
      >
        <span
          className="eyebrow"
          style={{ color: 'var(--text)', opacity: 0.7 }}
        >
          {title}
        </span>
        <span
          aria-hidden
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition:'transform .15s ease',
            display:   'inline-flex',
          }}
        >
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 16px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

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
      }}
    >
      {isB ? 'B-grade' : 'Warranty'}
    </span>
  )
}

function BackIcon() {
  return (
    <svg
      width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      width={12} height={12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      width={16} height={16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      width={11} height={11} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

/* PhotosToggle — keeps the inbound photo gallery hidden by default and
 * only mounts CasePhotos when the mechanic explicitly clicks Show.
 * Closing unmounts the gallery so the network fetch / blob URLs are
 * released. */
function PhotosToggle({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          all:           'unset',
          cursor:        'pointer',
          display:       'inline-flex',
          alignItems:    'center',
          gap:           6,
          padding:       '6px 12px',
          fontSize:      12,
          fontWeight:    500,
          color:         'var(--accent-text)',
          background:    'var(--accent-dim)',
          border:        '1px solid transparent',
          borderRadius:  999,
          marginBottom:  open ? 10 : 0,
        }}
        aria-expanded={open}
      >
        <CameraIcon />
        {open ? 'Hide photos' : 'Show photos'}
      </button>
      {open && <CasePhotos caseId={caseId} />}
    </div>
  )
}

function CameraIcon() {
  return (
    <svg
      width={12} height={12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}
