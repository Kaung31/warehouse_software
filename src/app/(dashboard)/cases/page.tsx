import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'

/**
 * Cases list page (WARRANTY only) — v2 redesign (April 2026).
 *
 * Replaces the old <table className="data-table"> layout with a Puzzler-style
 * row grid: each row is its own visual card with a scooter thumbnail, an
 * inline 5-step pipeline, a mechanic avatar, and an SLA-aware time pill.
 *
 * Key changes:
 *   • Stat strip at top — 4 metrics (total, my queue, in repair, overdue)
 *   • Row layout: thumbnail · order info · status pill · pipeline · mechanic · time
 *   • Filter chips use .filter-pill class from globals.css
 *   • Custom empty state using .empty-state
 *   • Pagination uses .filter-pill for consistency
 *   • Search field uses .search-wrap styling
 *   • Scooter thumbnail is a placeholder for now — when Photo model is wired
 *     to scooter, swap thumbContent for <img src={scooter.photoUrl} />
 *   • Removed dependency on LinkRow (uses Next Link directly)
 *   • Removed B-grade type column (this list is WARRANTY-only)
 *   • Pipeline matches the 5-stage map: Intake / CS / Repair / QC / Done
 *
 * Performance note: scooter brand + model now drive thumbnail color tinting
 * (deterministic hash) so each model gets a consistent placeholder color.
 * When we wire real photos this gets replaced.
 */


/* ─── Types ────────────────────────────────────────────────────────── */

type CaseRow = {
  id: string
  orderNumber: string
  status: string
  caseType: string
  faultDescription: string
  updatedAt: Date
  createdAt: Date
  scooter: { serialNumber: string; brand: string; model: string }
  customer: { name: string } | null
  mechanic: { name: string } | null
}


/* ─── Stage pipeline mapping (matches StageTracker) ───────────────── */

type StageStep = 0 | 1 | 2 | 3 | 4 | -1

const STATUS_TO_STEP: Record<string, { step: StageStep; loopback?: boolean }> = {
  // Pre-arrival (CS)
  NEW:                  { step: 1 },
  CS_TRIAGE:            { step: 1 },
  QUOTE_SENT:           { step: 1 },
  AWAITING_PICKUP:      { step: 1 },
  IN_TRANSIT:           { step: 1 },
  // Intake
  AWAITING_INBOUND:     { step: 0 },
  INBOUND_DIAGNOSIS:    { step: 0 },
  // CS
  AWAITING_CS:          { step: 1 },
  CS_RECHARGE:          { step: 1, loopback: true },
  DISPUTED:             { step: 1, loopback: true },
  // Repair
  WAITING_FOR_MECHANIC: { step: 2 },
  IN_REPAIR:            { step: 2 },
  AWAITING_PARTS:       { step: 2 },
  QC_FAILED:            { step: 2, loopback: true },
  // QC
  QUALITY_CONTROL:      { step: 3 },
  READY_TO_SHIP:        { step: 3 },
  // Done
  DISPATCHED:           { step: 4 },
  DELIVERED:            { step: 4 },
  BGRADE_RECORDED:      { step: 4 },
  // Off-pipeline
  CANCELLED:            { step: -1 },
}

/** SLA target in minutes per stage. Used by the .tis pill tone. */
const STAGE_SLA: Record<string, number> = {
  AWAITING_INBOUND:     240,    // 4h
  INBOUND_DIAGNOSIS:    180,    // 3h
  CS_TRIAGE:            240,    // 4h
  AWAITING_CS:          240,    // 4h
  CS_RECHARGE:          240,    // 4h
  DISPUTED:             480,    // 8h
  QUOTE_SENT:           2880,   // 2d
  AWAITING_PICKUP:      4320,   // 3d
  IN_TRANSIT:           4320,   // 3d
  WAITING_FOR_MECHANIC: 480,    // 8h
  IN_REPAIR:            1440,   // 24h
  AWAITING_PARTS:       4320,   // 3d
  QC_FAILED:            720,    // 12h
  QUALITY_CONTROL:      240,    // 4h
  READY_TO_SHIP:        240,    // 4h
}


/* ─── Role filter (which statuses each role's "My queue" shows) ──── */

const ROLE_FILTER: Record<string, string[]> = {
  MECHANIC:  ['WAITING_FOR_MECHANIC', 'IN_REPAIR', 'AWAITING_PARTS', 'QC_FAILED'],
  CS:        ['NEW', 'CS_TRIAGE', 'AWAITING_CS', 'CS_RECHARGE', 'DISPUTED'],
  WAREHOUSE: ['AWAITING_INBOUND', 'INBOUND_DIAGNOSIS', 'QUALITY_CONTROL', 'READY_TO_SHIP'],
}

/** Filter chips shown in the toolbar (UX-friendly subset, not every status). */
const FILTER_CHIPS = [
  'AWAITING_INBOUND',
  'AWAITING_CS',
  'WAITING_FOR_MECHANIC',
  'IN_REPAIR',
  'AWAITING_PARTS',
  'QUALITY_CONTROL',
  'QC_FAILED',
  'READY_TO_SHIP',
  'DISPUTED',
] as const


/* ─── Component ────────────────────────────────────────────────────── */

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) redirect('/dashboard')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1'))
  const take = 25
  const skip = (page - 1) * take
  const search = sp.q?.trim() ?? ''

  const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role)
  const defaultStatuses = ROLE_FILTER[user.role] ?? []
  const statusFilter = sp.status
    ? [sp.status]
    : isAdminOrManager
    ? []
    : defaultStatuses

  const where: Prisma.RepairOrderWhereInput = {
    caseType: 'WARRANTY',
    ...(statusFilter.length > 0
      ? { status: { in: statusFilter as never[] } }
      : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: 'insensitive' } },
            { scooter: { serialNumber: { contains: search, mode: 'insensitive' } } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [cases, total, queueCount, inRepairCount] = await Promise.all([
    prisma.repairOrder.findMany({
      where,
      take,
      skip,
      orderBy: { updatedAt: 'desc' },
      include: {
        scooter: { select: { serialNumber: true, brand: true, model: true } },
        customer: { select: { name: true } },
        mechanic: { select: { name: true } },
      },
    }),
    prisma.repairOrder.count({ where }),
    // "My queue" count for the current role
    prisma.repairOrder.count({
      where: {
        caseType: 'WARRANTY',
        status: { in: defaultStatuses as never[] },
      },
    }),
    // In repair count (system-wide)
    prisma.repairOrder.count({
      where: {
        caseType: 'WARRANTY',
        status: { in: ['IN_REPAIR', 'AWAITING_PARTS'] as never[] },
      },
    }),
  ])

  const pages = Math.ceil(total / take)

  // Compute overdue count from the loaded page (cheap approximation; for an
  // accurate count across all pages we'd need a DB-side computed column).
  const overdueOnPage = cases.filter(c => isOverdue(c.status, c.updatedAt)).length

  const buildHref = (overrides: Partial<{ status: string; page: number; q: string }>) => {
    const params = new URLSearchParams()
    const status = overrides.status ?? sp.status
    const q = overrides.q ?? search
    const p = overrides.page
    if (status) params.set('status', status)
    if (q) params.set('q', q)
    if (p && p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/cases${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="fade-up">
      <PageHeader
        title="Cases"
        sub={`${total} warranty case${total !== 1 ? 's' : ''}`}
        action={
          <Link href="/cases/new">
            <Btn variant="primary" iconLeft={<PlusIcon />}>New case</Btn>
          </Link>
        }
      />

      {/* Stat strip — 4 quick metrics */}
      <div
        className="grid4"
        style={{ marginBottom: 18 }}
      >
        <StatTile label="Total open" value={total} />
        <StatTile label="My queue" value={queueCount} accent />
        <StatTile label="In repair" value={inRepairCount} />
        <StatTile
          label="Overdue (this page)"
          value={overdueOnPage}
          tone={overdueOnPage > 0 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Search + filter bar */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 14,
          alignItems: 'center',
        }}
      >
        <form
          className="search-wrap"
          style={{ flex: 1, minWidth: 0, display: 'flex' }}
        >
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            name="q"
            defaultValue={search}
            placeholder="Search order #, serial, customer…"
          />
        </form>
      </div>

      {/* Filter pills */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <Link href={buildHref({ status: '' })}>
          <span className={`filter-pill${!sp.status ? ' on' : ''}`}>
            {isAdminOrManager ? 'All' : 'My queue'}
          </span>
        </Link>
        {FILTER_CHIPS.map(s => (
          <Link key={s} href={buildHref({ status: s })}>
            <span className={`filter-pill${sp.status === s ? ' on' : ''}`}>
              {humanizeStatus(s)}
            </span>
          </Link>
        ))}
      </div>

      {/* Cases list — Puzzler-style rows */}
      {cases.length === 0 ? (
        <EmptyState
          search={search}
          status={sp.status}
        />
      ) : (
        <div className="row-grid">
          {cases.map(c => (
            <CaseRowItem key={c.id} c={c as CaseRow} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 6,
            padding: '20px 0 8px',
            flexWrap: 'wrap',
          }}
        >
          <Link href={buildHref({ page: Math.max(1, page - 1) })}>
            <span className={`filter-pill${page === 1 ? ' on' : ''}`}>
              ← Prev
            </span>
          </Link>
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === pages || Math.abs(p - page) <= 2)
            .map((p, i, arr) => (
              <Fragment key={p}>
                {i > 0 && arr[i - 1] !== p - 1 && (
                  <span
                    style={{
                      padding: '5px 12px',
                      color: 'var(--text-faint)',
                      fontSize: 11,
                    }}
                  >
                    …
                  </span>
                )}
                <Link href={buildHref({ page: p })}>
                  <span className={`filter-pill${p === page ? ' on' : ''}`}>
                    {p}
                  </span>
                </Link>
              </Fragment>
            ))}
          <Link href={buildHref({ page: Math.min(pages, page + 1) })}>
            <span className={`filter-pill${page === pages ? ' on' : ''}`}>
              Next →
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function CaseRowItem({ c }: { c: CaseRow }) {
  const stageInfo = STATUS_TO_STEP[c.status] ?? { step: -1 as StageStep }
  const elapsedMin = Math.max(
    0,
    Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 60_000)
  )
  const slaMin = STAGE_SLA[c.status] ?? 0
  const tone = slaTone(elapsedMin, slaMin)

  return (
    <Link
      href={`/cases/${c.id}`}
      className={`row-grid-item${stageInfo.loopback ? ' danger' : ''}`}
    >
      {/* Scooter thumbnail */}
      <ScooterThumb brand={c.scooter.brand} model={c.scooter.model} />

      {/* Order + customer */}
      <div style={{ minWidth: 0 }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--sub)',
            marginBottom: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {c.orderNumber} · {c.scooter.brand} {c.scooter.model}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {c.customer?.name ?? <span style={{ color: 'var(--text-faint)' }}>No customer</span>}
        </div>
      </div>

      {/* Status pill */}
      <div>
        <StatusBadge status={c.status} />
      </div>

      {/* Inline pipeline */}
      <RowPipeline step={stageInfo.step} loopback={stageInfo.loopback} />

      {/* Mechanic + time */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <MechanicAvatar name={c.mechanic?.name ?? null} />
        <span
          className={`tis${tone}`}
          style={{ flexShrink: 0 }}
          title={`In stage for ${humanizeMins(elapsedMin)}`}
        >
          {humanizeMins(elapsedMin)}
        </span>
      </div>

      {/* Action menu indicator */}
      <div
        style={{
          textAlign: 'right',
          color: 'var(--text-faint)',
          fontSize: 18,
          letterSpacing: 1,
        }}
      >
        ›
      </div>
    </Link>
  )
}


function StatTile({
  label,
  value,
  accent,
  tone,
}: {
  label: string
  value: number
  accent?: boolean
  tone?: 'danger' | 'neutral'
}) {
  const isDanger = tone === 'danger' && value > 0
  return (
    <div
      className="stat-card"
      style={
        accent
          ? { background: 'var(--accent-dim)', borderColor: 'transparent' }
          : isDanger
          ? { background: 'var(--red-bg)', borderColor: 'var(--red-b)' }
          : undefined
      }
    >
      <div
        className="stat-num"
        style={{
          color: accent
            ? 'var(--accent-text)'
            : isDanger
            ? 'var(--red-text)'
            : 'var(--text)',
        }}
      >
        {value}
      </div>
      <div
        className="stat-label"
        style={{
          color: accent
            ? 'var(--accent-text)'
            : isDanger
            ? 'var(--red-text)'
            : 'var(--sub)',
        }}
      >
        {label}
      </div>
    </div>
  )
}


function RowPipeline({
  step,
  loopback,
}: {
  step: StageStep
  loopback?: boolean
}) {
  if (step < 0) {
    return (
      <span
        style={{
          fontSize: 11,
          color: 'var(--text-faint)',
          fontStyle: 'italic',
        }}
      >
        Off pipeline
      </span>
    )
  }
  return (
    <div className="pipeline">
      {[0, 1, 2, 3, 4].map((i, idx) => {
        const done = i < step
        const current = i === step
        const failed = loopback && current
        const dotClass = failed
          ? 'failed'
          : done
          ? 'done'
          : current
          ? 'current'
          : ''
        const lineClass = i < 4 && i < step ? 'done' : ''
        return (
          <div key={i} style={{ display: 'contents' }}>
            <span className={`pl-dot ${dotClass}`} />
            {idx < 4 && <span className={`pl-line ${lineClass}`} />}
          </div>
        )
      })}
    </div>
  )
}


function MechanicAvatar({ name }: { name: string | null }) {
  if (!name) {
    return (
      <div
        className="av av-sm av-empty"
        title="Unassigned"
        style={{ fontSize: 11 }}
      >
        ?
      </div>
    )
  }
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
  return (
    <div
      className="av av-sm"
      title={name}
      style={{ background: hashColor(name) }}
    >
      {initials}
    </div>
  )
}


function ScooterThumb({
  brand,
  model,
}: {
  brand: string
  model: string
}) {
  // Placeholder thumbnail with a deterministic tint per model.
  // When Photo model is wired to scooter, swap this for an <img>.
  const tint = hashColor(`${brand}-${model}`)
  return (
    <div
      className="thumb thumb-md"
      style={{ background: tintBg(tint), color: tint }}
      aria-label={`${brand} ${model}`}
    >
      <ScooterIcon />
    </div>
  )
}


function EmptyState({
  search,
  status,
}: {
  search: string
  status?: string
}) {
  const filtered = !!(search || status)
  return (
    <div className="card">
      <div className="empty-state">
        <div className="empty-state-icon">
          <CasesIcon />
        </div>
        <div className="empty-state-title">
          {filtered ? 'No cases match your filters' : 'No cases yet'}
        </div>
        <div className="empty-state-msg">
          {filtered
            ? 'Try removing a filter or clearing your search to see more cases.'
            : 'When customers send in scooters for warranty repair, their cases will appear here.'}
        </div>
        {filtered ? (
          <Link href="/cases">
            <Btn variant="secondary" size="sm">
              Clear filters
            </Btn>
          </Link>
        ) : (
          <Link href="/cases/new">
            <Btn variant="primary" size="sm" iconLeft={<PlusIcon />}>
              Create first case
            </Btn>
          </Link>
        )}
      </div>
    </div>
  )
}


/* ─── Helpers ──────────────────────────────────────────────────────── */

function humanizeStatus(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function humanizeMins(mins: number): string {
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function slaTone(elapsedMin: number, slaMin: number): '' | ' warn' | ' over' {
  if (slaMin <= 0) return ''
  const ratio = elapsedMin / slaMin
  if (ratio >= 1) return ' over'
  if (ratio >= 0.8) return ' warn'
  return ''
}

function isOverdue(status: string, updatedAt: Date): boolean {
  const sla = STAGE_SLA[status] ?? 0
  if (sla === 0) return false
  const elapsedMin = Math.floor(
    (Date.now() - new Date(updatedAt).getTime()) / 60_000
  )
  return elapsedMin >= sla
}

/** Deterministic color from a string — gives every model a stable tint. */
function hashColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  // Curated palette of role/avatar-friendly colors
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

function tintBg(hex: string): string {
  // Very light tint of the same hex, for thumbnail backgrounds
  // We render the icon in `hex` over a 12% alpha background of `hex`.
  return `${hex}1F`
}

// Need Fragment for pagination ellipsis
import { Fragment } from 'react'


/* ─── Inline icons ─────────────────────────────────────────────────── */

function PlusIcon() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SearchIcon() {
  return (
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
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ScooterIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="17" cy="18" r="2.5" />
      <path d="M7.5 18H14.5" />
      <path d="M15 18 L18 5" />
      <path d="M14 5 H22" />
    </svg>
  )
}

function CasesIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z" />
      <path d="M16 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}