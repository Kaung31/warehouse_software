'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * BgradeInboundPanel — warehouse intake for B-GRADE cases.
 *
 * Different from warranty InboundPanel:
 *   • No customer payment context (B-grade is a retailer return,
 *     not a customer warranty repair)
 *   • No error codes / diagnosis form (the mechanic handles assessment
 *     during their grading workflow)
 *   • No recharge loop (no customer to recharge)
 *   • Primary action is pallet assignment — B-grades go straight to
 *     a pallet on arrival, then mechanic picks them up later
 *
 * v2 changes (April 2026):
 *   • Replaced inline-styled blue arrival banner with .al-i info alert
 *   • Pallet selector now shows visual capacity bars (green / amber / red
 *     based on fill percentage) instead of just "3/10 items"
 *   • Cleaner empty state when no pallets exist — proper empty-state
 *     icon and a clear CTA link
 *   • All inline section labels become .eyebrow class
 *   • Confirm button uses inline SVG check icon (not ✓ emoji)
 *   • Loading state via the new Btn `loading` prop
 *   • Error displays in .al.al-d alert box
 */

type Pallet = {
  id: string
  palletNumber: string
  locationCode: string | null
  _count: { items: number }
  capacity: number
}

type Props = {
  caseId: string
  serialNumber: string
}

export default function BgradeInboundPanel({ caseId, serialNumber }: Props) {
  const router = useRouter()
  const [pallets, setPallets] = useState<Pallet[]>([])
  const [selectedPallet, setSelectedPallet] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/pallets?purpose=BGRADE&isSealed=false')
      .then(r => r.json())
      .then(d => setPallets(Array.isArray(d.data) ? d.data : []))
      .catch(() => setPallets([]))
  }, [])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/inbound-triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          internalNotes: internalNotes.trim() || undefined,
          palletId: selectedPallet || undefined,
        }),
      })
      if (res.ok) router.refresh()
      else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to confirm arrival')
      }
    } finally {
      setBusy(false)
    }
  }

  /** Selected pallet detail for the visual fill display */
  const selectedPalletData = pallets.find(p => p.id === selectedPallet)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Title ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          B-Grade arrival
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          Confirm scooter arrival and assign to an inbound pallet
        </div>
      </div>

      {/* ── Arrival banner ── */}
      <div className="al al-i" style={{ marginBottom: 0 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <Icon name="info" size={14} />
        </span>
        <div>
          Confirm scooter{' '}
          <span className="mono" style={{ fontWeight: 500 }}>
            {serialNumber}
          </span>{' '}
          has arrived. Assigning to a pallet is optional but recommended.
        </div>
      </div>

      {/* ── Pallet selector ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Assign to pallet (optional)
        </div>

        {pallets.length === 0 ? (
          <div
            className="empty-state"
            style={{ padding: '20px 12px', background: 'var(--s2)', borderRadius: 'var(--radius)' }}
          >
            <div className="empty-state-icon" style={{ width: 40, height: 40 }}>
              <Icon name="package" size={18} />
            </div>
            <div className="empty-state-title" style={{ fontSize: 13 }}>
              No open B-grade pallets
            </div>
            <div className="empty-state-msg" style={{ fontSize: 12 }}>
              You can still confirm arrival without a pallet, or create a new
              pallet first.
            </div>
            <a
              href="/pallets/new"
              style={{
                fontSize: 12,
                color: 'var(--accent-text)',
                textDecoration: 'none',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon name="plus" size={12} />
              Create pallet
            </a>
          </div>
        ) : (
          <>
            <select
              value={selectedPallet}
              onChange={e => setSelectedPallet(e.target.value)}
              disabled={busy}
            >
              <option value="">— Skip for now —</option>
              {pallets.map(p => (
                <option key={p.id} value={p.id}>
                  {p.palletNumber}
                  {p.locationCode ? ` · ${p.locationCode}` : ''} ·{' '}
                  {p._count.items}/{p.capacity} items
                </option>
              ))}
            </select>

            {/* Capacity bar for the currently selected pallet */}
            {selectedPalletData && (
              <PalletCapacityBar pallet={selectedPalletData} />
            )}
          </>
        )}
      </div>

      {/* ── Internal notes ── */}
      <div>
        <label htmlFor="internal-notes">Internal notes (optional)</label>
        <input
          id="internal-notes"
          value={internalNotes}
          onChange={e => setInternalNotes(e.target.value)}
          placeholder="Any notes for the mechanic…"
          disabled={busy}
        />
      </div>

      {error && (
        <div className="al al-d" style={{ marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* ── Confirm button ── */}
      <Btn
        variant="primary"
        size="lg"
        loading={busy}
        onClick={confirm}
        iconLeft={<Icon name="check" size={14} />}
      >
        Confirm arrival — send to mechanic queue
      </Btn>
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function PalletCapacityBar({ pallet }: { pallet: Pallet }) {
  const items = pallet._count.items
  const capacity = pallet.capacity || 1
  const ratio = items / capacity
  const percent = Math.min(100, Math.round(ratio * 100))

  const tone =
    ratio >= 0.9
      ? 'red'
      : ratio >= 0.7
      ? 'amber'
      : 'green'

  const fillColor =
    tone === 'red'
      ? 'var(--red)'
      : tone === 'amber'
      ? 'var(--amber)'
      : 'var(--green)'

  const labelColor =
    tone === 'red'
      ? 'var(--red-text)'
      : tone === 'amber'
      ? 'var(--amber-text)'
      : 'var(--green-text)'

  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--sub)', fontWeight: 500 }}
        >
          {pallet.palletNumber}
          {pallet.locationCode && (
            <span style={{ opacity: 0.7 }}> · {pallet.locationCode}</span>
          )}
        </span>
        <span
          className="mono"
          style={{ fontSize: 11, color: labelColor, fontWeight: 500 }}
        >
          {items} / {capacity}
        </span>
      </div>
      <div
        style={{
          height: 5,
          background: 'var(--dim)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: fillColor,
            borderRadius: 3,
            transition: 'width .3s',
          }}
        />
      </div>
      {tone === 'red' && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--red-text)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Icon name="alert" size={11} />
          Pallet nearly full — consider another
        </div>
      )}
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName = 'check' | 'info' | 'alert' | 'package' | 'plus'

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
    case 'check':
      return (
        <svg {...p} strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
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
    case 'package':
      return (
        <svg {...p}>
          <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...p} strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )
    default:
      return null
  }
}