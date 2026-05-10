'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/ui/StatusBadge'
import Btn from '@/components/ui/Btn'

/**
 * WarehouseMap — visual warehouse floor plan + table view.
 *
 * v2 changes (April 2026):
 *   • All emojis (🗺 ⊞ ✕ 🔍 ▾ ▸ ⬇ 📋 🚚 🔧 ✓ 📦 ◈ ▤) replaced with
 *     inline SVG icons.
 *   • All hardcoded hex colors (#dc2626, #ea580c, etc.) for the
 *     occupancy heat scale replaced with CSS variables — adapts to
 *     dark mode.
 *   • Stats strip uses .grid4 + .stat-card classes (consistent with
 *     dashboard / cases / parts pages).
 *   • Tab buttons use .filter-pill class instead of inline-styled custom
 *     buttons.
 *   • Section labels use .eyebrow class throughout.
 *   • Map zone tiles get a subtle hover lift (matches Puzzler reference).
 *   • Removed glow box-shadows on selected tiles — kept flat per the
 *     design direction we've established for the rest of the app.
 *   • Buttons use the <Btn> component instead of raw className-style
 *     buttons (consistent loading / icon / variants).
 *   • Search wrapper uses .search-wrap with proper magnifying-glass SVG.
 *   • Cleaner detail panel header with proper close button (.btn-icon).
 *
 * No backend changes. Same WarehouseMap props as before.
 */

type Rack = {
  id: string
  name: string
  code: string
  type: string
  capacity: number
  activeCases: number
  isActive: boolean
  description: string | null
}
type Zone = Rack & { racks: Rack[] }
type CaseRow = {
  id: string
  orderNumber: string
  status: string
  brand: string
  model: string
}

type Props = {
  zones: Zone[]
  casesByLocation: Record<string, CaseRow[]>
  isAdmin: boolean
}

/* ─── Heat scale ──────────────────────────────────────────────────── */

function fillPct(active: number, capacity: number) {
  if (!capacity) return active > 0 ? 50 : 0
  return Math.min(100, Math.round((active / capacity) * 100))
}

type FillTheme = {
  bg: string
  border: string
  text: string
  fillBar: string
}

function fillTheme(pct: number): FillTheme {
  if (pct >= 100) {
    return {
      bg: 'var(--red-bg)',
      border: 'var(--red-b)',
      text: 'var(--red-text)',
      fillBar: 'var(--red)',
    }
  }
  if (pct >= 80) {
    return {
      bg: 'var(--orange-bg)',
      border: 'var(--orange-b)',
      text: 'var(--orange-text)',
      fillBar: 'var(--orange)',
    }
  }
  if (pct >= 60) {
    return {
      bg: 'var(--amber-bg)',
      border: 'var(--amber-b)',
      text: 'var(--amber-text)',
      fillBar: 'var(--amber)',
    }
  }
  return {
    bg: 'var(--green-bg)',
    border: 'var(--green-b)',
    text: 'var(--green-text)',
    fillBar: 'var(--green)',
  }
}

/* ─── Zone constants ──────────────────────────────────────────────── */

type ZoneIconName =
  | 'INBOUND_AREA'
  | 'WARRANTY_RACK'
  | 'DISPATCH_AREA'
  | 'MECHANIC_QUEUE'
  | 'QC_RACK'
  | 'STORAGE'
  | 'BGRADE_AREA'
  | 'RACK'

const ZONE_LABELS: Record<string, string> = {
  INBOUND_AREA: 'Inbound',
  WARRANTY_RACK: 'Warranty Hold',
  DISPATCH_AREA: 'Dispatch',
  MECHANIC_QUEUE: 'Workshop',
  QC_RACK: 'QC Area',
  STORAGE: 'Storage',
  BGRADE_AREA: 'B-Grade',
  RACK: 'Rack',
}

const GRID_POS: Record<string, [number, number, number, number]> = {
  INBOUND_AREA: [1, 3, 1, 2],
  WARRANTY_RACK: [3, 5, 1, 2],
  DISPATCH_AREA: [5, 7, 1, 2],
  MECHANIC_QUEUE: [1, 4, 2, 3],
  QC_RACK: [4, 6, 2, 3],
  STORAGE: [6, 7, 2, 3],
  BGRADE_AREA: [1, 4, 3, 4],
}

/** Sample zones rendered when database has none configured yet. */
const SAMPLE: Zone[] = [
  { id: 's1', name: 'Inbound Area',  code: 'IB-01', type: 'INBOUND_AREA',   capacity: 20, activeCases:  8, isActive: true, description: null, racks: [] },
  { id: 's2', name: 'Warranty Hold', code: 'WR-01', type: 'WARRANTY_RACK',  capacity: 30, activeCases: 14, isActive: true, description: null, racks: [] },
  { id: 's3', name: 'Dispatch Bay',  code: 'DS-01', type: 'DISPATCH_AREA',  capacity: 15, activeCases:  3, isActive: true, description: null, racks: [] },
  { id: 's4', name: 'Workshop',      code: 'MQ-01', type: 'MECHANIC_QUEUE', capacity: 25, activeCases: 20, isActive: true, description: null, racks: [] },
  { id: 's5', name: 'QC Area',       code: 'QC-01', type: 'QC_RACK',        capacity: 10, activeCases:  5, isActive: true, description: null, racks: [] },
  { id: 's6', name: 'Storage',       code: 'ST-01', type: 'STORAGE',        capacity: 50, activeCases: 12, isActive: true, description: null, racks: [] },
  { id: 's7', name: 'B-Grade Zone',  code: 'BG-01', type: 'BGRADE_AREA',    capacity: 40, activeCases: 18, isActive: true, description: null, racks: [] },
]


/* ─── Component ────────────────────────────────────────────────────── */

export default function WarehouseMap({
  zones,
  casesByLocation,
  isAdmin,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<'map' | 'table'>('map')
  const [selZoneId, setSelZoneId] = useState<string | null>(null)
  const [selRackId, setSelRackId] = useState<string | null>(null)

  const isSample = zones.length === 0
  const displayZones = isSample ? SAMPLE : zones

  const totalZones = displayZones.length
  const totalRacks = displayZones.reduce((s, z) => s + z.racks.length, 0)
  const totalCases = displayZones.reduce(
    (s, z) =>
      s + z.activeCases + z.racks.reduce((r, rack) => r + rack.activeCases, 0),
    0
  )
  const nearFull = displayZones.filter(
    z => fillPct(z.activeCases, z.capacity) >= 80
  ).length

  const selZone = selZoneId
    ? displayZones.find(z => z.id === selZoneId) ?? null
    : null
  const selRack =
    selZone && selRackId
      ? selZone.racks.find(r => r.id === selRackId) ?? null
      : null
  const detailLoc = selRack ?? selZone
  const detailCases = detailLoc ? casesByLocation[detailLoc.id] ?? [] : []

  return (
    <div className="fade-up">
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 18,
          gap: 12,
        }}
      >
        <div>
          <h1 className="page-title">Warehouse map</h1>
          <p className="page-sub">
            {totalZones} zone{totalZones === 1 ? '' : 's'} ·{' '}
            {totalRacks} rack{totalRacks === 1 ? '' : 's'} · {totalCases}{' '}
            active case{totalCases === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* ── Sample data banner ── */}
      {isSample && (
        <div className="al al-i" style={{ marginBottom: 18 }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <Icon name="info" size={14} />
          </span>
          <div>
            Showing sample data — no warehouse locations configured yet.
            {isAdmin && ' Use the table view to add zones.'}
          </div>
        </div>
      )}

      {/* ── Stats strip ── */}
      <div className="grid4" style={{ marginBottom: 18 }}>
        <StatTile label="Zones" value={totalZones} />
        <StatTile label="Racks / shelves" value={totalRacks} />
        <StatTile
          label="Active cases"
          value={totalCases}
          tone={totalCases > 0 ? 'accent' : 'neutral'}
        />
        <StatTile
          label="Zones near capacity"
          value={nearFull}
          tone={nearFull > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {/* ── View tabs ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setTab('map')}
          className={`filter-pill${tab === 'map' ? ' on' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="grid" size={12} />
          Floor map
        </button>
        <button
          type="button"
          onClick={() => setTab('table')}
          className={`filter-pill${tab === 'table' ? ' on' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="list" size={12} />
          Table view
        </button>
      </div>

      {/* ── Floor map ── */}
      {tab === 'map' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selZone ? '1fr 380px' : '1fr',
            gap: 18,
          }}
        >
          <div className="card" style={{ padding: 20 }}>
            <div
              className="eyebrow"
              style={{
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="floor" size={11} />
              ScooterHub · Warehouse floor
              {isSample && (
                <span
                  className="badge badge-na"
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    padding: '1px 7px',
                    letterSpacing: '.05em',
                  }}
                >
                  SAMPLE
                </span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gridTemplateRows: 'repeat(3, auto)',
                gap: 10,
              }}
            >
              {displayZones.map(zone => {
                const pos = GRID_POS[zone.type]
                if (!pos) return null
                const [cs, ce, rs, re] = pos
                const pct = fillPct(zone.activeCases, zone.capacity)
                const theme = fillTheme(pct)
                const sel = selZoneId === zone.id
                return (
                  <button
                    key={zone.id}
                    type="button"
                    onClick={() => {
                      setSelZoneId(sel ? null : zone.id)
                      setSelRackId(null)
                    }}
                    style={{
                      gridColumn: `${cs}/${ce}`,
                      gridRow: `${rs}/${re}`,
                      background: sel ? 'var(--accent)' : theme.bg,
                      border: `1.5px solid ${
                        sel ? 'var(--accent)' : theme.border
                      }`,
                      borderRadius: 10,
                      padding: '14px 16px',
                      cursor: 'pointer',
                      transition: 'transform .15s, box-shadow .15s, background .15s',
                      minHeight: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-1px)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            color: sel ? '#fff' : theme.text,
                            marginBottom: 4,
                          }}
                        >
                          <ZoneIcon name={zone.type as ZoneIconName} />
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '.06em',
                            color: sel ? '#fff' : theme.text,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {zone.name}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 1,
                            color: sel ? '#fff' : theme.text,
                          }}
                        >
                          {zone.activeCases}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: sel
                              ? 'rgba(255,255,255,.7)'
                              : 'var(--text-faint)',
                          }}
                        >
                          {zone.capacity ? `/ ${zone.capacity}` : 'cases'}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      {zone.racks.length > 0 && (
                        <div
                          style={{
                            fontSize: 10,
                            color: sel
                              ? 'rgba(255,255,255,.75)'
                              : 'var(--sub)',
                            marginBottom: 5,
                          }}
                        >
                          {zone.racks.length} rack
                          {zone.racks.length !== 1 ? 's' : ''}
                        </div>
                      )}
                      <div
                        style={{
                          height: 4,
                          background: sel
                            ? 'rgba(255,255,255,.25)'
                            : 'var(--dim)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: sel ? '#fff' : theme.fillBar,
                            borderRadius: 2,
                            transition: 'width .3s',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          color: sel
                            ? 'rgba(255,255,255,.7)'
                            : 'var(--text-faint)',
                          marginTop: 3,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {pct}% filled
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Detail panel */}
          {selZone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="card" style={{ padding: '18px 20px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 14,
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {selZone.name}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--sub)',
                        marginTop: 2,
                      }}
                    >
                      {selZone.code}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelZoneId(null)
                      setSelRackId(null)
                    }}
                    className="btn-icon"
                    aria-label="Close detail"
                    title="Close"
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
                {(() => {
                  const pct = fillPct(selZone.activeCases, selZone.capacity)
                  const theme = fillTheme(pct)
                  return (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ color: 'var(--sub)' }}>Active cases</span>
                        <span
                          style={{
                            fontWeight: 600,
                            color: 'var(--text)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {selZone.activeCases}
                          {selZone.capacity ? ` / ${selZone.capacity}` : ''}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 6,
                          background: 'var(--dim)',
                          borderRadius: 3,
                          overflow: 'hidden',
                          marginBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: theme.fillBar,
                            borderRadius: 3,
                            transition: 'width .3s',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: theme.text,
                          fontWeight: 500,
                        }}
                      >
                        {pct}% capacity used
                      </div>
                    </div>
                  )
                })()}
              </div>

              {selZone.racks.length > 0 && (
                <div className="card" style={{ padding: '16px 20px' }}>
                  <div className="eyebrow" style={{ marginBottom: 12 }}>
                    Racks / Shelves
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                    }}
                  >
                    {selZone.racks.map(rack => {
                      const pct = fillPct(rack.activeCases, rack.capacity)
                      const theme = fillTheme(pct)
                      const sel = selRackId === rack.id
                      return (
                        <button
                          key={rack.id}
                          type="button"
                          onClick={() => setSelRackId(sel ? null : rack.id)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            cursor: 'pointer',
                            transition: 'all .12s',
                            border: `1.5px solid ${
                              sel ? 'var(--accent)' : 'var(--border)'
                            }`,
                            background: sel
                              ? 'var(--accent-dim)'
                              : 'var(--s2)',
                            textAlign: 'left',
                            fontFamily: 'inherit',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: sel ? 'var(--accent-text)' : 'var(--text)',
                              marginBottom: 2,
                            }}
                          >
                            {rack.name}
                          </div>
                          <div
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: 'var(--text-faint)',
                            }}
                          >
                            {rack.code}
                          </div>
                          <div
                            style={{
                              height: 3,
                              background: 'var(--dim)',
                              borderRadius: 2,
                              margin: '6px 0 2px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: '100%',
                                background: theme.fillBar,
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: theme.text,
                              fontWeight: 500,
                            }}
                          >
                            {rack.activeCases}
                            {rack.capacity ? `/${rack.capacity}` : ''} cases
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  {isAdmin && !isSample && (
                    <AddRackForm
                      zoneId={selZone.id}
                      onAdded={() => router.refresh()}
                    />
                  )}
                </div>
              )}

              {selZone.racks.length === 0 && isAdmin && !isSample && (
                <div className="card" style={{ padding: '16px 20px' }}>
                  <AddRackForm
                    zoneId={selZone.id}
                    onAdded={() => router.refresh()}
                  />
                </div>
              )}

              <div className="card" style={{ padding: '16px 20px' }}>
                <div className="eyebrow" style={{ marginBottom: 12 }}>
                  Cases in {detailLoc?.name}
                </div>
                {detailCases.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-faint)',
                      textAlign: 'center',
                      padding: '16px 0',
                    }}
                  >
                    No active cases here
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {detailCases.map(c => (
                      <Link
                        key={c.id}
                        href={`/cases/${c.id}`}
                        style={{ textDecoration: 'none' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 10px',
                            borderRadius: 7,
                            background: 'var(--s2)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <span
                              className="mono"
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: 'var(--accent-text)',
                              }}
                            >
                              {c.orderNumber}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--sub)',
                                marginLeft: 8,
                              }}
                            >
                              {c.brand} {c.model}
                            </span>
                          </div>
                          <StatusBadge status={c.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Table view ── */}
      {tab === 'table' && (
        <LocationTable
          zones={displayZones}
          isAdmin={isAdmin}
          isSample={isSample}
          onRefresh={() => router.refresh()}
        />
      )}
    </div>
  )
}


/* ─── StatTile ────────────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'neutral' | 'accent' | 'warn'
}) {
  const styles =
    tone === 'accent' && value > 0
      ? {
          background: 'var(--accent-dim)',
          borderColor: 'transparent',
          numColor: 'var(--accent-text)',
          labelColor: 'var(--accent-text)',
        }
      : tone === 'warn' && value > 0
      ? {
          background: 'var(--amber-bg)',
          borderColor: 'transparent',
          numColor: 'var(--amber-text)',
          labelColor: 'var(--amber-text)',
        }
      : {
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          numColor: 'var(--text)',
          labelColor: 'var(--sub)',
        }
  return (
    <div
      className="stat-card"
      style={{ background: styles.background, borderColor: styles.borderColor }}
    >
      <div className="stat-num" style={{ color: styles.numColor }}>
        {value}
      </div>
      <div className="stat-label" style={{ color: styles.labelColor }}>
        {label}
      </div>
    </div>
  )
}


/* ─── AddRackForm ─────────────────────────────────────────────────── */

function AddRackForm({
  zoneId,
  onAdded,
}: {
  zoneId: string
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!name.trim() || !code.trim()) {
      setErr('Name and code required')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          type: 'RACK',
          capacity: capacity ? parseInt(capacity, 10) : 0,
          parentId: zoneId,
        }),
      })
      if (res.ok) {
        setOpen(false)
        setName('')
        setCode('')
        setCapacity('')
        onAdded()
      } else {
        const b = await res.json().catch(() => ({}))
        setErr(b.error ?? 'Failed')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 7,
          fontSize: 12,
          border: '1.5px dashed var(--border)',
          background: 'transparent',
          color: 'var(--sub)',
          cursor: 'pointer',
          marginTop: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          fontFamily: 'inherit',
        }}
      >
        <Icon name="plus" size={11} />
        Add rack
      </button>
    )
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--s2)',
        borderRadius: 8,
        border: '1px solid var(--border)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        New rack
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <input
          placeholder="Name (e.g. Rack A1)"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          placeholder="Code (e.g. IB-R1)"
          value={code}
          onChange={e => setCode(e.target.value)}
          className="mono"
        />
      </div>
      <input
        type="number"
        placeholder="Capacity (0 = unlimited)"
        value={capacity}
        onChange={e => setCapacity(e.target.value)}
        style={{ marginBottom: 8 }}
        inputMode="numeric"
        min="0"
      />
      {err && (
        <div className="al al-d" style={{ marginBottom: 8 }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn
          variant="primary"
          size="sm"
          loading={busy}
          onClick={submit}
        >
          Add rack
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Btn>
      </div>
    </div>
  )
}


/* ─── LocationTable ───────────────────────────────────────────────── */

function LocationTable({
  zones,
  isAdmin,
  isSample,
  onRefresh,
}: {
  zones: Zone[]
  isAdmin: boolean
  isSample: boolean
  onRefresh: () => void
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [occFilter, setOccFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCap, setEditCap] = useState('')
  const [busy, setBusy] = useState(false)
  const [sortCol, setSortCol] = useState<'name' | 'cases' | 'fill'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleExpand(id: string) {
    setExpanded(p => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function handleSort(col: 'name' | 'cases' | 'fill') {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortCol(col)
      setSortDir('asc')
    }
  }
  async function saveEdit(id: string) {
    setBusy(true)
    await fetch(`/api/locations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName || undefined,
        capacity: editCap ? parseInt(editCap, 10) : 0,
      }),
    })
    setBusy(false)
    setEditing(null)
    onRefresh()
  }
  async function deactivate(id: string) {
    await fetch(`/api/locations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    })
    onRefresh()
  }

  type Row = { zone: Zone; rack?: Rack; isRack: boolean }
  const rows: Row[] = []
  for (const z of zones) {
    rows.push({ zone: z, isRack: false })
    if (expanded.has(z.id))
      z.racks.forEach(r => rows.push({ zone: z, rack: r, isRack: true }))
  }

  const filtered = rows.filter(({ zone, rack, isRack }) => {
    const loc = isRack ? rack! : zone
    const pct = fillPct(loc.activeCases, loc.capacity)
    return (
      (!search ||
        loc.name.toLowerCase().includes(search.toLowerCase()) ||
        loc.code.toLowerCase().includes(search.toLowerCase())) &&
      (!typeFilter || (isRack ? 'RACK' : zone.type) === typeFilter) &&
      (!occFilter ||
        (occFilter === 'near' && pct >= 60 && pct < 100) ||
        (occFilter === 'full' && pct >= 100) ||
        (occFilter === 'ok' && pct < 60))
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    const la = a.isRack ? a.rack! : a.zone
    const lb = b.isRack ? b.rack! : b.zone
    if (a.isRack !== b.isRack) return 0
    let d = 0
    if (sortCol === 'name') d = la.name.localeCompare(lb.name)
    if (sortCol === 'cases') d = la.activeCases - lb.activeCases
    if (sortCol === 'fill')
      d =
        fillPct(la.activeCases, la.capacity) -
        fillPct(lb.activeCases, lb.capacity)
    return sortDir === 'asc' ? d : -d
  })

  const SortIndicator = ({ col }: { col: typeof sortCol }) => (
    <span
      style={{
        marginLeft: 3,
        fontSize: 9,
        color: sortCol === col ? 'var(--accent)' : 'var(--text-faint)',
      }}
    >
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  const TYPES = [
    'INBOUND_AREA',
    'WARRANTY_RACK',
    'BGRADE_AREA',
    'MECHANIC_QUEUE',
    'QC_RACK',
    'DISPATCH_AREA',
    'STORAGE',
    'RACK',
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div className="search-wrap" style={{ maxWidth: 260, display: 'flex' }}>
          <span className="search-icon">
            <Icon name="search" size={13} />
          </span>
          <input
            placeholder="Search name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value="">All types</option>
          {TYPES.map(t => (
            <option key={t} value={t}>
              {ZONE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
        <select
          value={occFilter}
          onChange={e => setOccFilter(e.target.value)}
          style={{ width: 'auto', minWidth: 160 }}
        >
          <option value="">All occupancy</option>
          <option value="ok">OK (&lt;60%)</option>
          <option value="near">Near full (60–99%)</option>
          <option value="full">Full (100%+)</option>
        </select>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--text-faint)',
          }}
        >
          {sorted.length} row{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th
                style={{ cursor: 'pointer' }}
                onClick={() => handleSort('name')}
              >
                Name / code <SortIndicator col="name" />
              </th>
              <th>Type</th>
              <th
                style={{ cursor: 'pointer' }}
                onClick={() => handleSort('cases')}
              >
                Cases <SortIndicator col="cases" />
              </th>
              <th>Capacity</th>
              <th
                style={{ cursor: 'pointer', minWidth: 140 }}
                onClick={() => handleSort('fill')}
              >
                Fill <SortIndicator col="fill" />
              </th>
              <th>Status</th>
              {isAdmin && !isSample && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 7 : 6}
                  style={{
                    textAlign: 'center',
                    color: 'var(--text-faint)',
                    padding: '32px 0',
                  }}
                >
                  No locations match
                </td>
              </tr>
            ) : (
              sorted.map(({ zone, rack, isRack }) => {
                const loc = isRack ? rack! : zone
                const pct = fillPct(loc.activeCases, loc.capacity)
                const theme = fillTheme(pct)
                const isEd = editing === loc.id
                return (
                  <tr key={`${zone.id}-${rack?.id ?? 'z'}`}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          paddingLeft: isRack ? 24 : 0,
                        }}
                      >
                        {!isRack && zone.racks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(zone.id)}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 4,
                              background: 'var(--s3)',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              color: 'var(--sub)',
                            }}
                            aria-label={
                              expanded.has(zone.id)
                                ? 'Collapse'
                                : 'Expand'
                            }
                          >
                            <Icon
                              name={
                                expanded.has(zone.id)
                                  ? 'chevron-down'
                                  : 'chevron-right'
                              }
                              size={10}
                            />
                          </button>
                        )}
                        <span
                          style={{
                            color: 'var(--sub)',
                            display: 'inline-flex',
                            flexShrink: 0,
                          }}
                        >
                          {isRack ? (
                            <Icon name="rack" size={14} />
                          ) : (
                            <ZoneIcon
                              name={zone.type as ZoneIconName}
                              size={14}
                            />
                          )}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          {isEd ? (
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              style={{ width: 140, padding: '3px 7px', fontSize: 12 }}
                            />
                          ) : (
                            <div
                              style={{ fontSize: 13, fontWeight: 500 }}
                            >
                              {loc.name}
                            </div>
                          )}
                          <div
                            className="mono"
                            style={{
                              fontSize: 11,
                              color: 'var(--text-faint)',
                            }}
                          >
                            {loc.code}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '3px 10px',
                          borderRadius: 999,
                          background: 'var(--s2)',
                          color: 'var(--sub)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {ZONE_LABELS[isRack ? 'RACK' : zone.type] ?? zone.type}
                      </span>
                    </td>
                    <td>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                        }}
                      >
                        {loc.activeCases}
                      </span>
                    </td>
                    <td>
                      {isEd ? (
                        <input
                          type="number"
                          inputMode="numeric"
                          value={editCap}
                          onChange={e => setEditCap(e.target.value)}
                          style={{ width: 80, padding: '3px 7px', fontSize: 12 }}
                        />
                      ) : (
                        <span style={{ color: 'var(--sub)' }}>
                          {loc.capacity || '∞'}
                        </span>
                      )}
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            maxWidth: 80,
                            height: 6,
                            background: 'var(--dim)',
                            borderRadius: 3,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, pct)}%`,
                              height: '100%',
                              background: theme.fillBar,
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: theme.bg,
                            color: theme.text,
                            border: `1px solid ${theme.border}`,
                            minWidth: 42,
                            textAlign: 'center',
                          }}
                        >
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${loc.isActive ? 'badge-pass' : 'badge-na'}`}
                        style={{ fontSize: 11, fontWeight: 500 }}
                      >
                        {loc.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && !isSample && (
                      <td>
                        {isEd ? (
                          <div style={{ display: 'flex', gap: 5 }}>
                            <Btn
                              variant="success"
                              size="sm"
                              loading={busy}
                              onClick={() => saveEdit(loc.id)}
                            >
                              Save
                            </Btn>
                            <Btn
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </Btn>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 5 }}>
                            <Btn
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(loc.id)
                                setEditName(loc.name)
                                setEditCap(
                                  loc.capacity ? String(loc.capacity) : ''
                                )
                              }}
                            >
                              Edit
                            </Btn>
                            {loc.isActive && (
                              <Btn
                                variant="danger"
                                size="sm"
                                onClick={() => deactivate(loc.id)}
                              >
                                Deactivate
                              </Btn>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}


/* ─── ZoneIcon ────────────────────────────────────────────────────── */

function ZoneIcon({
  name,
  size = 18,
}: {
  name: ZoneIconName
  size?: number
}) {
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
    case 'INBOUND_AREA':
      return (
        <svg {...p}>
          <line x1="12" y1="3" x2="12" y2="17" />
          <polyline points="6 11 12 17 18 11" />
          <line x1="3" y1="21" x2="21" y2="21" />
        </svg>
      )
    case 'WARRANTY_RACK':
      return (
        <svg {...p}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      )
    case 'DISPATCH_AREA':
      return (
        <svg {...p}>
          <rect x="1" y="6" width="13" height="11" rx="1" />
          <path d="M14 9h4l3 4v4h-7" />
          <circle cx="6" cy="20" r="2" />
          <circle cx="18" cy="20" r="2" />
        </svg>
      )
    case 'MECHANIC_QUEUE':
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    case 'QC_RACK':
      return (
        <svg {...p} strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'STORAGE':
      return (
        <svg {...p}>
          <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
      )
    case 'BGRADE_AREA':
      return (
        <svg {...p}>
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
          <line x1="12" y1="22" x2="12" y2="15.5" />
          <polyline points="22 8.5 12 15.5 2 8.5" />
        </svg>
      )
    case 'RACK':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="6" rx="1" />
          <rect x="3" y="11" width="18" height="6" rx="1" />
          <line x1="7" y1="6" x2="7" y2="6.01" />
          <line x1="7" y1="14" x2="7" y2="14.01" />
        </svg>
      )
    default:
      return null
  }
}


/* ─── Generic icons ───────────────────────────────────────────────── */

type IconName =
  | 'info'
  | 'x'
  | 'plus'
  | 'search'
  | 'grid'
  | 'list'
  | 'floor'
  | 'rack'
  | 'chevron-right'
  | 'chevron-down'

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
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
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
    case 'x':
      return (
        <svg {...p} strokeWidth="2">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...p} strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      )
    case 'grid':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      )
    case 'list':
      return (
        <svg {...p}>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      )
    case 'floor':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
        </svg>
      )
    case 'rack':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="6" rx="1" />
          <rect x="3" y="11" width="18" height="6" rx="1" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg {...p} strokeWidth="2">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      )
    case 'chevron-down':
      return (
        <svg {...p} strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      )
    default:
      return null
  }
}