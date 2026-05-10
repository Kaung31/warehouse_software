'use client'

import { useEffect, useState } from 'react'
import StatusBadge from '@/components/ui/StatusBadge'

/**
 * StageTracker — read-only stage view shown to roles that don't own
 * the current stage of a case.
 *
 * v2 changes (April 2026):
 *   • Pipeline now uses the .pipeline / .pl-dot / .pl-line classes from
 *     globals.css. Current step pulses with the accent dot animation.
 *     Past steps are green ("done"), future steps are dim outline.
 *   • All emoji icons replaced with semantic SVG icons (Lucide style,
 *     1.6 px stroke). Each stage maps to an icon that reflects what
 *     the team actually does in that stage.
 *   • Added support for the new workflow states from the expanded
 *     pipeline: CS_TRIAGE, QUOTE_SENT, AWAITING_PICKUP, IN_TRANSIT,
 *     INBOUND_DIAGNOSIS, CS_RECHARGE, DELIVERED.
 *   • Recharge loops (CS_RECHARGE, QC_FAILED, DISPUTED) render the
 *     pipeline with a red "back-step" indicator instead of forward green.
 *   • Time-in-stage uses the new .tis pill with SLA-aware tone:
 *       <  80% of SLA → neutral
 *       80-100% SLA → .tis.warn (amber)
 *       >  100% SLA → .tis.over (red, blinking)
 *   • Elapsed time live-ticks every 60 s so the panel stays accurate
 *     without a page refresh.
 *   • Status pill rendered via StatusBadge (single source of truth)
 *     instead of inline-styled pill.
 *   • Replaced inline-style soup with .card + .ir info-row classes
 *     from globals.css.
 *   • Added "is being recharged" hint copy when state is CS_RECHARGE
 *     so the viewer understands the case looped back.
 */

type Props = {
  status: string
  mechanicName?: string | null
  startedAt?: string | null
  userRole: string
}

/* ─── Stage mapping ────────────────────────────────────────────────── */

type StageMeta = {
  label: string
  /** Position on the 5-step pipeline (0 – 4). -1 means off-pipeline (cancelled). */
  step: number
  /** Owning team for this stage. */
  owner: 'CUSTOMER' | 'CS' | 'WAREHOUSE' | 'MECHANIC' | '—'
  /** Icon name for the header circle. */
  icon: IconName
  /** SLA target in minutes for this stage. */
  slaMinutes: number
  /** True if this state is a "back-loop" (recharge / failed). */
  loopback?: boolean
}

const STAGE_INFO: Record<string, StageMeta> = {
  // Pre-arrival (CS owns, customer ships)
  NEW:                  { label: 'New Case Created',     step: 1, owner: 'CS',        icon: 'envelope',   slaMinutes: 240 },
  CS_TRIAGE:            { label: 'CS Triage',            step: 1, owner: 'CS',        icon: 'clipboard',  slaMinutes: 240 },
  QUOTE_SENT:           { label: 'Quote Sent to Customer',step: 1, owner: 'CUSTOMER', icon: 'send',       slaMinutes: 2880 },
  AWAITING_PICKUP:      { label: 'Awaiting Pickup',      step: 1, owner: 'CUSTOMER', icon: 'truck',      slaMinutes: 4320 },
  IN_TRANSIT:           { label: 'In Transit',           step: 1, owner: 'CUSTOMER', icon: 'truck',      slaMinutes: 4320 },

  // Warehouse intake — Inbound now does diagnosis
  AWAITING_INBOUND:     { label: 'Awaiting Inbound',     step: 0, owner: 'WAREHOUSE', icon: 'inbox',      slaMinutes: 240 },
  INBOUND_DIAGNOSIS:    { label: 'Inbound Diagnosis',    step: 0, owner: 'WAREHOUSE', icon: 'magnify',    slaMinutes: 180 },

  // CS recharge & dispute (back-loops)
  AWAITING_CS:          { label: 'CS Payment Review',    step: 1, owner: 'CS',        icon: 'card',       slaMinutes: 240 },
  CS_RECHARGE:          { label: 'CS Recharge — Re-quoting', step: 1, owner: 'CS',    icon: 'refresh',    slaMinutes: 240, loopback: true },
  DISPUTED:             { label: 'Disputed — CS Review', step: 1, owner: 'CS',        icon: 'alert',      slaMinutes: 480, loopback: true },

  // Mechanic
  WAITING_FOR_MECHANIC: { label: 'Mechanic Queue',       step: 2, owner: 'MECHANIC',  icon: 'wrench',     slaMinutes: 480 },
  IN_REPAIR:            { label: 'In Repair',            step: 2, owner: 'MECHANIC',  icon: 'wrench',     slaMinutes: 1440 },
  AWAITING_PARTS:       { label: 'Awaiting Parts',       step: 2, owner: 'MECHANIC',  icon: 'package',    slaMinutes: 4320 },
  QC_FAILED:            { label: 'QC Failed — Re-Repair',step: 2, owner: 'MECHANIC',  icon: 'refresh',    slaMinutes: 720, loopback: true },

  // QC + dispatch
  QUALITY_CONTROL:      { label: 'Quality Control',      step: 3, owner: 'WAREHOUSE', icon: 'check',      slaMinutes: 240 },
  READY_TO_SHIP:        { label: 'Ready to Ship',        step: 3, owner: 'WAREHOUSE', icon: 'box',        slaMinutes: 240 },

  // Terminal
  DISPATCHED:           { label: 'Dispatched',           step: 4, owner: 'WAREHOUSE', icon: 'truck',      slaMinutes: 4320 },
  DELIVERED:            { label: 'Delivered to Customer',step: 4, owner: 'CUSTOMER',  icon: 'check',      slaMinutes: 0 },
  BGRADE_RECORDED:      { label: 'B-Grade Recorded',     step: 4, owner: 'WAREHOUSE', icon: 'tag',        slaMinutes: 0 },
  CANCELLED:            { label: 'Cancelled',            step: -1, owner: '—',        icon: 'x',          slaMinutes: 0 },
}

const PIPELINE = [
  { step: 0, label: 'Intake' },
  { step: 1, label: 'CS' },
  { step: 2, label: 'Repair' },
  { step: 3, label: 'QC' },
  { step: 4, label: 'Done' },
] as const


/* ─── Icon set ─────────────────────────────────────────────────────── */

type IconName =
  | 'inbox'
  | 'magnify'
  | 'card'
  | 'envelope'
  | 'clipboard'
  | 'send'
  | 'truck'
  | 'wrench'
  | 'package'
  | 'box'
  | 'check'
  | 'refresh'
  | 'alert'
  | 'tag'
  | 'eye'
  | 'x'

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'inbox':
      return (
        <svg {...p}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      )
    case 'magnify':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      )
    case 'card':
      return (
        <svg {...p}>
          <rect x="2" y="6" width="20" height="14" rx="2" />
          <line x1="2" y1="11" x2="22" y2="11" />
        </svg>
      )
    case 'envelope':
      return (
        <svg {...p}>
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22 6 12 13 2 6" />
        </svg>
      )
    case 'clipboard':
      return (
        <svg {...p}>
          <path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z" />
          <path d="M16 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M9 12h6M9 16h6" />
        </svg>
      )
    case 'send':
      return (
        <svg {...p}>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      )
    case 'truck':
      return (
        <svg {...p}>
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      )
    case 'wrench':
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    case 'package':
      return (
        <svg {...p}>
          <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
      )
    case 'box':
      return (
        <svg {...p}>
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...p}>
          <polyline points="1 4 1 10 7 10" />
          <polyline points="23 20 23 14 17 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...p}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'tag':
      return (
        <svg {...p}>
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
        </svg>
      )
    case 'eye':
      return (
        <svg {...p}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'x':
      return (
        <svg {...p}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      )
    default:
      return null
  }
}


/* ─── Helpers ──────────────────────────────────────────────────────── */

function timeAgo(mins: number): string {
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

/** Returns the .tis tone class based on how much SLA budget is consumed. */
function slaTone(elapsedMin: number, slaMin: number): '' | ' warn' | ' over' {
  if (slaMin <= 0) return ''
  const ratio = elapsedMin / slaMin
  if (ratio >= 1) return ' over'
  if (ratio >= 0.8) return ' warn'
  return ''
}


/* ─── Component ────────────────────────────────────────────────────── */

export default function StageTracker({
  status,
  mechanicName,
  startedAt,
  userRole, // eslint-disable-line @typescript-eslint/no-unused-vars
}: Props) {
  const info = STAGE_INFO[status] ?? {
    label: status.replace(/_/g, ' '),
    step: -1,
    owner: '—' as const,
    icon: 'eye' as IconName,
    slaMinutes: 0,
  }

  // Live-tick elapsed time every 60s so the panel stays accurate
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const elapsedMin = startedAt
    ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000))
    : null

  const tone = elapsedMin != null && info.slaMinutes > 0
    ? slaTone(elapsedMin, info.slaMinutes)
    : ''

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '18px 20px' }}>
        {/* Stage header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              flexShrink: 0,
              background: info.loopback ? 'var(--red-bg)' : 'var(--accent-dim)',
              color: info.loopback ? 'var(--red-text)' : 'var(--accent-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={info.icon} size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {info.label}
            </div>
            <div className="eyebrow" style={{ marginTop: 2 }}>
              {info.step >= 0 ? `Stage ${info.step + 1} of 5` : 'Off pipeline'}
              {info.loopback && ' · Looped back'}
            </div>
          </div>
          {elapsedMin != null && (
            <span className={`tis${tone}`} title="Time in current stage">
              <Icon name="refresh" size={11} />
              {timeAgo(elapsedMin)}
            </span>
          )}
        </div>

        {/* Pipeline (5 dots, 4 lines between) */}
        <div className="pipeline" style={{ marginBottom: 8 }}>
          {PIPELINE.map((p, i) => {
            const done = info.step >= 0 && p.step < info.step
            const current = p.step === info.step
            const failed = info.loopback && current
            const dotClass = failed ? 'failed' : done ? 'done' : current ? 'current' : ''
            const lineClass =
              i < PIPELINE.length - 1 && info.step >= 0 && p.step < info.step ? 'done' : ''
            return (
              <div key={p.step} style={{ display: 'contents' }}>
                <span className={`pl-dot ${dotClass}`} />
                {i < PIPELINE.length - 1 && <span className={`pl-line ${lineClass}`} />}
              </div>
            )
          })}
        </div>

        {/* Pipeline labels */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            marginBottom: 18,
          }}
        >
          {PIPELINE.map(p => (
            <div
              key={p.step}
              className="pl-label"
              style={{
                color: p.step === info.step ? 'var(--accent)' : 'var(--text-faint)',
                fontWeight: p.step === info.step ? 600 : 500,
              }}
            >
              {p.label}
            </div>
          ))}
        </div>

        {/* Info rows */}
        <div>
          <div className="ir">
            <span className="ik">Status</span>
            <span className="iv">
              <StatusBadge status={status} />
            </span>
          </div>
          <div className="ir">
            <span className="ik">Owner</span>
            <span className="iv">{info.owner}</span>
          </div>
          {mechanicName && (
            <div className="ir">
              <span className="ik">Assigned to</span>
              <span className="iv">{mechanicName}</span>
            </div>
          )}
          {elapsedMin != null && (
            <div className="ir">
              <span className="ik">In this stage</span>
              <span className="iv mono">{timeAgo(elapsedMin)}</span>
            </div>
          )}
          {info.slaMinutes > 0 && (
            <div className="ir">
              <span className="ik">Target SLA</span>
              <span className="iv mono">{timeAgo(info.slaMinutes)}</span>
            </div>
          )}
        </div>

        {/* View-only notice */}
        <div
          style={{
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: info.loopback ? 'var(--red-bg)' : 'var(--s2)',
            border: `1px solid ${info.loopback ? 'var(--red-b)' : 'var(--border)'}`,
            color: info.loopback ? 'var(--red-text)' : 'var(--sub)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <Icon name={info.loopback ? 'alert' : 'eye'} size={14} />
          </span>
          <span>
            {info.loopback ? (
              <>
                This case has looped back to <strong>{info.owner}</strong>.{' '}
                {status === 'CS_RECHARGE' &&
                  'A team member found additional work that requires customer re-approval.'}
                {status === 'QC_FAILED' && 'QC failed — the mechanic is re-doing the repair.'}
                {status === 'DISPUTED' && 'CS is reviewing a customer dispute.'}
              </>
            ) : (
              <>
                You&apos;re viewing this case. Actions at this stage are handled by{' '}
                <strong>{info.owner}</strong>.
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}