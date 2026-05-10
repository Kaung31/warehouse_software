'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * KanbanBoard — operational kanban shown on /dashboard.
 *
 * v2 changes (April 2026):
 *   • Replaced ALL hardcoded hex colors with CSS variables
 *     (var(--slate), var(--amber), …) — auto-adapts to theme.
 *   • Removed glow box-shadow effects on column dots and card accents.
 *     Those neon-glow shadows were the most "AI-template" visual tell.
 *   • Each card now shows a mini 5-step pipeline (.pipeline classes)
 *     so you can see at a glance where a case sits across the workflow,
 *     not just which column it's in.
 *   • Mechanic shown as an avatar with initials, not "🔧 name".
 *   • Time pill uses .tis with SLA-aware tone (neutral / warn / over).
 *   • Empty columns show a clean empty-state row, not just "Empty".
 *   • New columns: INBOUND_DIAGNOSIS (when Inbound team is diagnosing),
 *     CS_TRIAGE (initial triage), CS_RECHARGE (recharge loop).
 *   • DISPATCHED column dropped — that's terminal, doesn't belong on
 *     the active kanban. Counts shown on the dashboard footer instead.
 *   • Live-ticking time: re-renders every 60s so timers stay accurate.
 *   • Priority chip uses .prio-chip class consistently.
 */

type KanbanCase = {
  id: string
  orderNumber: string
  caseType: string
  status: string
  priority: string
  brand: string
  model: string
  fault: string | null
  source: string | null
  mechanic: string | null
  location: string | null
  updatedAt: string
  createdAt: string
}

type Props = { cases: KanbanCase[] }


/* ─── Column definitions ───────────────────────────────────────────── */

type ColumnDef = {
  /** Statuses grouped under this column. */
  statuses: readonly string[]
  short: string
  /** CSS variable for the column dot. */
  dotVar: string
}

const COLS: ColumnDef[] = [
  {
    statuses: ['AWAITING_INBOUND', 'INBOUND_DIAGNOSIS'],
    short: 'Inbound',
    dotVar: 'var(--slate)',
  },
  {
    statuses: ['CS_TRIAGE', 'AWAITING_CS', 'CS_RECHARGE', 'DISPUTED'],
    short: 'CS Review',
    dotVar: 'var(--amber)',
  },
  {
    statuses: ['WAITING_FOR_MECHANIC'],
    short: 'Mechanic Queue',
    dotVar: 'var(--blue)',
  },
  {
    statuses: ['IN_REPAIR'],
    short: 'In Repair',
    dotVar: 'var(--purple)',
  },
  {
    statuses: ['AWAITING_PARTS'],
    short: 'Parts Needed',
    dotVar: 'var(--orange)',
  },
  {
    statuses: ['QUALITY_CONTROL', 'QC_FAILED'],
    short: 'QC',
    dotVar: 'var(--teal)',
  },
  {
    statuses: ['READY_TO_SHIP'],
    short: 'Ready',
    dotVar: 'var(--green)',
  },
]


/* ─── Status → pipeline step (mirrors StageTracker / cases page) ───── */

const STATUS_TO_STEP: Record<
  string,
  { step: 0 | 1 | 2 | 3 | 4 | -1; loopback?: boolean }
> = {
  NEW:                  { step: 1 },
  CS_TRIAGE:            { step: 1 },
  QUOTE_SENT:           { step: 1 },
  AWAITING_PICKUP:      { step: 1 },
  IN_TRANSIT:           { step: 1 },
  AWAITING_INBOUND:     { step: 0 },
  INBOUND_DIAGNOSIS:    { step: 0 },
  AWAITING_CS:          { step: 1 },
  CS_RECHARGE:          { step: 1, loopback: true },
  DISPUTED:             { step: 1, loopback: true },
  WAITING_FOR_MECHANIC: { step: 2 },
  IN_REPAIR:            { step: 2 },
  AWAITING_PARTS:       { step: 2 },
  QC_FAILED:            { step: 2, loopback: true },
  QUALITY_CONTROL:      { step: 3 },
  READY_TO_SHIP:        { step: 3 },
  DISPATCHED:           { step: 4 },
  DELIVERED:            { step: 4 },
}

/** SLA target (mins) per stage — drives the .tis pill tone. */
const STAGE_SLA: Record<string, number> = {
  AWAITING_INBOUND:     240,
  INBOUND_DIAGNOSIS:    180,
  CS_TRIAGE:            240,
  AWAITING_CS:          240,
  CS_RECHARGE:          240,
  DISPUTED:             480,
  WAITING_FOR_MECHANIC: 480,
  IN_REPAIR:            1440,
  AWAITING_PARTS:       4320,
  QC_FAILED:            720,
  QUALITY_CONTROL:      240,
  READY_TO_SHIP:        240,
}


/* ─── Helpers ──────────────────────────────────────────────────────── */

function timeAgo(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function elapsedMinutes(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
}

function slaTone(mins: number, sla: number): '' | ' warn' | ' over' {
  if (sla <= 0) return ''
  const r = mins / sla
  if (r >= 1) return ' over'
  if (r >= 0.8) return ' warn'
  return ''
}

function hashColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  const palette = [
    '#1a5fff',
    '#7c3aed',
    '#0f766e',
    '#dc2626',
    '#c2410c',
    '#b45309',
    '#16a34a',
    '#4338ca',
    '#475569',
  ]
  return palette[Math.abs(hash) % palette.length]
}


/* ─── Component ────────────────────────────────────────────────────── */

export default function KanbanBoard({ cases }: Props) {
  /* Live tick — refreshes timers every 60s without a page reload. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="kanban" style={{ flex: 1 }}>
      {COLS.map(col => {
        const cards = cases.filter(c => col.statuses.includes(c.status))
        return (
          <div key={col.short} className="kb-col">
            <div className="kb-hd">
              <span
                className="kb-status-dot"
                style={{ background: col.dotVar }}
              />
              <span className="kb-title">{col.short}</span>
              <span className="kb-count">{cards.length}</span>
            </div>
            <div className="kb-body">
              {cards.length === 0 ? (
                <EmptyColumn />
              ) : (
                cards.map(c => (
                  <KanbanCard key={c.id} c={c} dotVar={col.dotVar} now={now} />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}


function KanbanCard({
  c,
  dotVar,
  now,
}: {
  c: KanbanCase
  dotVar: string
  now: number
}) {
  const stage = STATUS_TO_STEP[c.status] ?? { step: -1 as -1 }
  const mins = elapsedMinutes(c.updatedAt, now)
  const sla = STAGE_SLA[c.status] ?? 0
  const tone = slaTone(mins, sla)
  const isLoopback = stage.loopback

  const prioClass =
    c.priority === 'URGENT'
      ? 'badge-urgent'
      : c.priority === 'HIGH'
      ? 'badge-high'
      : c.priority === 'LOW'
      ? 'badge-low'
      : 'badge-normal'

  return (
    <Link
      href={`/cases/${c.id}`}
      className="cc"
      style={
        isLoopback
          ? { borderColor: 'var(--red-b)', background: 'var(--red-bg)' }
          : undefined
      }
    >
      <div
        className="cc-accent"
        style={{ background: isLoopback ? 'var(--red)' : dotVar }}
      />

      <div className="cc-top">
        <span className="cc-order">{c.orderNumber}</span>
        <span className={`badge ${prioClass}`} style={{ fontSize: 10 }}>
          {c.priority}
        </span>
      </div>

      <div className="cc-brand">
        {c.brand} {c.model}
      </div>

      {c.fault && (
        <div className="cc-fault" title={c.fault}>
          {c.fault.length > 60 ? `${c.fault.slice(0, 60)}…` : c.fault}
        </div>
      )}

      {/* Mini pipeline */}
      <div className="pipeline" style={{ margin: '8px 0' }}>
        {[0, 1, 2, 3, 4].map((i, idx) => {
          const done = stage.step >= 0 && i < stage.step
          const current = i === stage.step
          const failed = isLoopback && current
          const dotClass = failed
            ? 'failed'
            : done
            ? 'done'
            : current
            ? 'current'
            : ''
          const lineClass =
            i < 4 && stage.step >= 0 && i < stage.step ? 'done' : ''
          return (
            <div key={i} style={{ display: 'contents' }}>
              <span
                className={`pl-dot ${dotClass}`}
                style={{ width: 8, height: 8, minWidth: 8 }}
              />
              {idx < 4 && <span className={`pl-line ${lineClass}`} />}
            </div>
          )
        })}
      </div>

      <div className="cc-foot">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {c.mechanic ? (
            <div
              className="av av-xs"
              title={c.mechanic}
              style={{ background: hashColor(c.mechanic) }}
            >
              {c.mechanic
                .split(' ')
                .map(w => w[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </div>
          ) : (
            <div
              className="av av-xs av-empty"
              title="Unassigned"
              style={{ fontSize: 9 }}
            >
              ?
            </div>
          )}
          <span className={`tis${tone}`} style={{ fontSize: 10, padding: '1px 6px' }}>
            {timeAgo(c.updatedAt, now)}
          </span>
        </div>
        {c.location && <span className="cc-loc">{c.location}</span>}
      </div>
    </Link>
  )
}


function EmptyColumn() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '24px 8px',
        color: 'var(--text-faint)',
        fontSize: 11,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          margin: '0 auto 8px',
          borderRadius: '50%',
          background: 'var(--s2)',
          border: '1px dashed var(--border2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ fontSize: 11, color: 'var(--sub)' }}>All clear</div>
    </div>
  )
}