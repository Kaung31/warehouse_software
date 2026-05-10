'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * DispatchPanel — final shipping panel shown when status is
 * READY_TO_SHIP (and as a confirmation when DISPATCHED).
 *
 * v2 changes (April 2026):
 *   • Title + eyebrow + descriptive subtitle matching other panels
 *   • QC-passed banner uses .al .al-s class instead of inline styles
 *   • Carrier info card up top — tells operator exactly what's about
 *     to happen (DPD · Standard · ~1 day) before they hit the button
 *   • Tracking number display: when present, shows in a clean mono
 *     card with one-click copy-to-clipboard
 *   • Dispatched state redesigned — proper success card with check
 *     icon (no more giant 📦 emoji), shows tracking number prominently,
 *     and offers a "Track shipment" link out to DPD
 *   • Big primary "Generate label & dispatch" button with printer SVG
 *     (replacing the ⎙ Unicode character which renders inconsistently)
 *   • Helpful warning copy: "This action cannot be undone — DPD label
 *     will be generated and the customer will be notified"
 *   • Per-action loading via Btn's `loading` prop
 *
 * Backend unchanged: POST /api/repairs/[id]/ship returns
 * { trackingNumber, labelPdf } where labelPdf is base64.
 */

type Props = {
  caseId: string
  repairId: string
  status: string
}

export default function DispatchPanel({ caseId, repairId, status }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tracking, setTracking] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generateLabel() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/repairs/${repairId}/ship`, {
        method: 'POST',
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to generate DPD label')
        return
      }
      const { data } = await res.json()
      if (data?.trackingNumber) setTracking(data.trackingNumber)

      // Open label PDF in a new tab so operator can print
      if (data?.labelPdf) {
        try {
          const blob = new Blob(
            [Uint8Array.from(atob(data.labelPdf), c => c.charCodeAt(0))],
            { type: 'application/pdf' }
          )
          window.open(URL.createObjectURL(blob), '_blank')
        } catch {
          // Non-fatal — label saved server-side anyway
        }
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function copyTracking() {
    if (!tracking) return
    try {
      await navigator.clipboard.writeText(tracking)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore — clipboard may be unavailable in some contexts */
    }
  }

  /* ─── DISPATCHED state — read-only success view ──────────────────── */
  if (status === 'DISPATCHED') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Dispatch
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
            Scooter dispatched
          </div>
        </div>

        {/* Success card */}
        <div
          style={{
            padding: '20px 22px',
            background: 'var(--green-bg)',
            border: '1px solid var(--green-b)',
            borderRadius: 'var(--radius-lg)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'var(--green)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
            }}
          >
            <Icon name="check" size={22} />
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--green-text)',
              marginBottom: 4,
            }}
          >
            Dispatched successfully
          </div>
          <div style={{ fontSize: 12, color: 'var(--green-text)', opacity: 0.8 }}>
            DPD label generated · customer notified
          </div>
        </div>

        {/* Tracking */}
        {tracking && (
          <TrackingCard
            tracking={tracking}
            onCopy={copyTracking}
            copied={copied}
          />
        )}
      </div>
    )
  }

  /* ─── READY_TO_SHIP state — generate label ───────────────────────── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Dispatch
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          Generate the shipping label and complete the case
        </div>
      </div>

      {/* QC passed banner */}
      <div className="al al-s" style={{ marginBottom: 0 }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <Icon name="check" size={14} />
        </span>
        <div>
          <strong>QC passed</strong> — ready to dispatch.
        </div>
      </div>

      {/* Carrier summary card */}
      <div
        style={{
          padding: '14px 16px',
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Carrier
        </div>
        <div className="ir">
          <span className="ik">Service</span>
          <span className="iv">DPD Standard</span>
        </div>
        <div className="ir">
          <span className="ik">Delivery</span>
          <span className="iv">Next working day</span>
        </div>
        <div className="ir">
          <span className="ik">Address</span>
          <span
            className="iv"
            style={{
              fontSize: 12,
              color: 'var(--sub)',
              fontStyle: 'italic',
              fontWeight: 400,
            }}
          >
            Customer's saved address
          </span>
        </div>
      </div>

      {/* Tracking — appears after a successful generate */}
      {tracking && (
        <TrackingCard
          tracking={tracking}
          onCopy={copyTracking}
          copied={copied}
        />
      )}

      {/* Error */}
      {error && (
        <div className="al al-d" style={{ marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* What happens warning */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--amber-bg)',
          border: '1px solid var(--amber-b)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          gap: 8,
          fontSize: 12,
          color: 'var(--amber-text)',
          lineHeight: 1.5,
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <Icon name="alert" size={13} />
        </span>
        <span>
          Generating the label will book the shipment with DPD, charge your
          account, and notify the customer. This cannot be undone.
        </span>
      </div>

      {/* Action */}
      <Btn
        variant="primary"
        size="lg"
        loading={busy}
        onClick={generateLabel}
        iconLeft={<Icon name="printer" size={14} />}
      >
        Generate label & dispatch
      </Btn>
    </div>
  )
}


/* ─── Tracking card sub-component ──────────────────────────────────── */

function TrackingCard({
  tracking,
  onCopy,
  copied,
}: {
  tracking: string
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent-dim)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        className="eyebrow"
        style={{ marginBottom: 6, color: 'var(--accent-text)' }}
      >
        Tracking number
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--accent-text)',
            letterSpacing: '.02em',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {tracking}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="btn btn-s btn-sm"
          style={{ flexShrink: 0 }}
          title="Copy tracking number"
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={`https://track.dpd.co.uk/parcels/${encodeURIComponent(
            tracking
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-s btn-sm"
          style={{
            flexShrink: 0,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="external" size={12} />
          Track
        </a>
      </div>
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName = 'check' | 'printer' | 'alert' | 'copy' | 'external'

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
        <svg {...p} strokeWidth="2.2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'printer':
      return (
        <svg {...p}>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
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
    case 'copy':
      return (
        <svg {...p}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )
    case 'external':
      return (
        <svg {...p}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )
    default:
      return null
  }
}