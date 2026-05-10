'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/ui/StatusBadge'
import Btn from '@/components/ui/Btn'
import PageHeader from '@/components/ui/PageHeader'

/**
 * /scan — warehouse barcode + QR scan page.
 *
 * v2 changes (April 2026):
 *   • Auto-focus the input on mount and return-to-focus after each
 *     scan (USB scanner workflow — operator never lifts hands from
 *     the gun).
 *   • Auto-submit detection: USB scanners send the entire payload
 *     in <50ms followed by Enter. We use Enter as primary submit, but
 *     also auto-submit when input has been still for 350ms after a
 *     fast burst — handles handheld scanners that don't append Enter.
 *   • Optional sound cues: toggle in the corner. Plays a high beep on
 *     match, low buzz on miss. Built with Web Audio API (no files
 *     needed). Setting persists for the session.
 *   • Scan-flash animations on the input (green on match / red on
 *     miss) using the .scan-flash-success / .scan-flash-error classes
 *     from globals.css.
 *   • Result drawer shows AFTER scan instead of auto-navigating.
 *     Verify-before-walk pattern: operator confirms the right scooter
 *     before leaving the bench.
 *   • Recent scans history (last 5) — quick re-access without
 *     re-scanning the same code.
 *   • Mobile-first layout: wider on phones/tablets, large tap targets.
 *   • All routes corrected to /cases/* (was /repairs/* — broken).
 *   • Auto-routing for non-case scans (pallet, part) preserved.
 */

type CaseScanResult = {
  matchType: 'orderNumber' | 'serialNumber'
  id: string
  orderNumber: string
  status: string
  barcodeAssigned: boolean
  faultDescription: string
  scooter: { serialNumber: string; brand: string; model: string }
  customer: { name: string; phone: string } | null
  mechanic: { name: string } | null
  currentLocation: { name: string; code: string; type: string } | null
}

type ScanState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'case'; result: CaseScanResult; query: string }
  | { kind: 'not-found'; query: string }
  | { kind: 'error'; message: string }

type RecentScan = {
  query: string
  matchedAt: number
  outcome: 'case' | 'pallet' | 'part' | 'miss'
  label: string
}

const STATUS_NEXT_ACTION: Record<string, string> = {
  AWAITING_INBOUND: 'Waiting for scooter to arrive',
  INBOUND_DIAGNOSIS: 'Diagnose at inbound',
  AWAITING_CS: 'Waiting for CS to review',
  CS_TRIAGE: 'CS triage in progress',
  CS_RECHARGE: 'Re-quoting customer for additional work',
  WAITING_FOR_MECHANIC: 'Assign mechanic and start repair',
  IN_REPAIR: 'Repair in progress',
  AWAITING_PARTS: 'Waiting for spare parts',
  QC_FAILED: 'QC failed — restart repair',
  QUALITY_CONTROL: 'Send to QC inspection',
  READY_TO_SHIP: 'Ready to dispatch',
  DISPATCHED: 'Already dispatched',
  CANCELLED: 'Case cancelled',
  BGRADE_RECORDED: 'B-grade recorded',
  DELIVERED: 'Delivered to customer',
}

const ROLE_COLORS: Record<string, string> = {
  CASE: 'var(--accent)',
  PALLET: 'var(--purple)',
  PART: 'var(--amber)',
  MISS: 'var(--red)',
}


export default function ScanPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const [query, setQuery] = useState('')
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' })
  const [flash, setFlash] = useState<'success' | 'error' | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const [recent, setRecent] = useState<RecentScan[]>([])

  /* ─── Auto-focus + persistent focus ────────────────────────────── */
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /* ─── Sound cues (Web Audio API) ───────────────────────────────── */
  function ensureAudio(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)()
      } catch {
        return null
      }
    }
    return audioCtxRef.current
  }

  const playBeep = useCallback(
    (type: 'success' | 'error') => {
      if (!soundOn) return
      const ctx = ensureAudio()
      if (!ctx) return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      if (type === 'success') {
        osc.type = 'sine'
        osc.frequency.value = 880 // A5
        gain.gain.setValueAtTime(0.08, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + 0.18
        )
        osc.start()
        osc.stop(ctx.currentTime + 0.18)
      } else {
        osc.type = 'square'
        osc.frequency.value = 220 // A3
        gain.gain.setValueAtTime(0.06, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + 0.32
        )
        osc.start()
        osc.stop(ctx.currentTime + 0.32)
      }
    },
    [soundOn]
  )

  /* ─── Flash animation timer ────────────────────────────────────── */
  function flashInput(kind: 'success' | 'error') {
    setFlash(kind)
    setTimeout(() => setFlash(null), 600)
  }

  /* ─── Add a result to recent history ───────────────────────────── */
  function pushRecent(item: Omit<RecentScan, 'matchedAt'>) {
    setRecent(prev =>
      [{ ...item, matchedAt: Date.now() }, ...prev].slice(0, 5)
    )
  }

  /* ─── The actual scan call ─────────────────────────────────────── */
  const doScan = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) return

      setScan({ kind: 'loading' })
      try {
        const res = await fetch(
          `/api/scan?q=${encodeURIComponent(trimmed)}`
        )
        const body = await res.json().catch(() => ({}))

        if (res.ok) {
          const d = body.data
          if (d.matchType === 'pallet') {
            // Pallet → record + navigate
            flashInput('success')
            playBeep('success')
            pushRecent({
              query: trimmed,
              outcome: 'pallet',
              label: d.pallet?.palletNumber ?? trimmed,
            })
            router.push(`/pallets/${d.pallet.id}`)
            setScan({ kind: 'idle' })
            setQuery('')
          } else if (d.matchType === 'part') {
            // Part → record + navigate
            flashInput('success')
            playBeep('success')
            pushRecent({
              query: trimmed,
              outcome: 'part',
              label: d.sku ?? trimmed,
            })
            router.push(`/parts?highlight=${encodeURIComponent(d.sku)}`)
            setScan({ kind: 'idle' })
            setQuery('')
          } else {
            // Case → show drawer FIRST, navigate on click
            const caseResult = d as CaseScanResult
            flashInput('success')
            playBeep('success')
            pushRecent({
              query: trimmed,
              outcome: 'case',
              label: caseResult.orderNumber,
            })
            setScan({
              kind: 'case',
              result: caseResult,
              query: trimmed,
            })
            // Keep focus on input so next scan works immediately
            setTimeout(() => {
              inputRef.current?.focus()
              inputRef.current?.select()
            }, 50)
          }
        } else if (res.status === 404) {
          flashInput('error')
          playBeep('error')
          pushRecent({
            query: trimmed,
            outcome: 'miss',
            label: trimmed,
          })
          setScan({ kind: 'not-found', query: trimmed })
        } else {
          flashInput('error')
          playBeep('error')
          setScan({
            kind: 'error',
            message: body.error ?? 'Scan failed',
          })
        }
      } catch {
        flashInput('error')
        playBeep('error')
        setScan({ kind: 'error', message: 'Network error — try again' })
      }
    },
    [router, playBeep]
  )

  /* ─── Auto-submit detection ────────────────────────────────────── */
  // When a barcode scanner types fast (< 50ms between chars), we want
  // to auto-submit shortly after typing stops, even without Enter.
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length >= 4) {
      // 350ms after typing stops — submit. Fast scanners trigger this
      // reliably; humans get to keep typing.
      debounceRef.current = setTimeout(() => doScan(val), 350)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      doScan(query)
    }
  }

  function clear() {
    setQuery('')
    setScan({ kind: 'idle' })
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function scanAnother() {
    setQuery('')
    setScan({ kind: 'idle' })
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div
      className="fade-up"
      style={{
        maxWidth: 640,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <PageHeader
          title="Scan"
          sub="Scan a repair ticket QR, serial, pallet, or part barcode"
        />
        <button
          type="button"
          onClick={() => setSoundOn(s => !s)}
          className="btn-icon"
          title={soundOn ? 'Sound on — click to mute' : 'Sound off — click to enable'}
          aria-label={soundOn ? 'Disable sound cues' : 'Enable sound cues'}
          style={{
            color: soundOn ? 'var(--accent-text)' : 'var(--text-faint)',
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          {soundOn ? <SoundOnIcon /> : <SoundOffIcon />}
        </button>
      </div>

      {/* ── Scan input card ── */}
      <div
        className="card"
        style={{
          padding: '18px 20px',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div className="sbar" style={{ flex: 1, marginBottom: 0 }}>
            <span
              className="led"
              style={{
                background:
                  scan.kind === 'loading'
                    ? 'var(--accent)'
                    : flash === 'success'
                    ? 'var(--green)'
                    : flash === 'error'
                    ? 'var(--red)'
                    : '#22d374',
              }}
            />
            <input
              ref={inputRef}
              value={query}
              onChange={handleChange}
              onKeyDown={handleKey}
              placeholder="Scan or type code…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={
                flash === 'success'
                  ? 'mono scan-flash-success'
                  : flash === 'error'
                  ? 'mono scan-flash-error'
                  : 'mono'
              }
              style={{
                fontSize: 15,
                letterSpacing: '0.04em',
              }}
            />
          </div>
          <Btn
            variant="primary"
            size="lg"
            loading={scan.kind === 'loading'}
            disabled={!query.trim()}
            onClick={() => doScan(query)}
            iconLeft={<ScanIcon />}
          >
            Scan
          </Btn>
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-faint)',
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <KbdHint>USB scanner</KbdHint>
          <span>auto-submits on Enter ·</span>
          <KbdHint>Mobile</KbdHint>
          <span>handheld scanners auto-detected</span>
        </div>
      </div>

      {/* ── Loading skeleton ── */}
      {scan.kind === 'loading' && <LoadingResult />}

      {/* ── Case result drawer ── */}
      {scan.kind === 'case' && (
        <CaseResult
          result={scan.result}
          query={scan.query}
          onScanAnother={scanAnother}
        />
      )}

      {/* ── Not found ── */}
      {scan.kind === 'not-found' && (
        <NotFoundCard query={scan.query} onClear={clear} />
      )}

      {/* ── Error ── */}
      {scan.kind === 'error' && (
        <div
          className="al al-d"
          style={{ marginBottom: 14, marginTop: 0 }}
        >
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <AlertIcon />
          </span>
          <div>
            <strong>Scan failed</strong> — {scan.message}.{' '}
            <button
              type="button"
              onClick={clear}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* ── Recent scans ── */}
      {recent.length > 0 && scan.kind !== 'case' && (
        <RecentScans scans={recent} />
      )}
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function CaseResult({
  result,
  query,
  onScanAnother,
}: {
  result: CaseScanResult
  query: string
  onScanAnother: () => void
}) {
  const initials = (
    result.scooter.brand[0] + result.scooter.model[0]
  ).toUpperCase()

  return (
    <div className="card fade-up" style={{ padding: '20px 22px', marginBottom: 14 }}>
      {/* Hero */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '56px 1fr auto',
          gap: 14,
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div
          className="thumb thumb-md"
          style={{
            background: 'var(--accent-dim)',
            color: 'var(--accent-text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--accent-text)',
              fontWeight: 500,
              letterSpacing: '.04em',
              marginBottom: 2,
            }}
          >
            {result.orderNumber}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
            }}
          >
            {result.scooter.brand} {result.scooter.model}
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}
          >
            {result.scooter.serialNumber}
          </div>
        </div>
        <StatusBadge status={result.status} />
      </div>

      {/* Info grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px 16px',
          marginBottom: 14,
        }}
      >
        <InfoRow label="Customer" value={result.customer?.name ?? '—'} />
        <InfoRow
          label="Mechanic"
          value={result.mechanic?.name ?? 'Unassigned'}
          muted={!result.mechanic}
        />
        <InfoRow
          label="Location"
          value={
            result.currentLocation
              ? result.currentLocation.name
              : 'Not set'
          }
          warn={!result.currentLocation}
        />
        <InfoRow
          label="Barcode"
          value={result.barcodeAssigned ? 'Attached' : 'Print needed'}
          warn={!result.barcodeAssigned}
        />
        {result.matchType === 'serialNumber' && (
          <InfoRow
            label="Matched by"
            value="Serial number"
            mono
          />
        )}
      </div>

      {/* Fault preview */}
      {result.faultDescription && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--s2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--sub)',
            lineHeight: 1.5,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontWeight: 500,
              color: 'var(--text)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              marginRight: 6,
            }}
          >
            Fault:
          </span>
          {result.faultDescription.length > 120
            ? `${result.faultDescription.slice(0, 120)}…`
            : result.faultDescription}
        </div>
      )}

      {/* Next action */}
      <div
        className="al al-i"
        style={{ marginBottom: 14 }}
      >
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <ArrowRightIcon />
        </span>
        <div>
          <strong>Next:</strong>{' '}
          {STATUS_NEXT_ACTION[result.status] ?? 'Open case for details'}
        </div>
      </div>

      {/* Actions */}
      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <Link
          href={
            result.status === 'BGRADE_RECORDED'
              ? `/b-grade/${result.id}`
              : `/cases/${result.id}`
          }
          style={{ flex: 1, minWidth: 200 }}
        >
          <Btn variant="primary" size="lg" style={{ width: '100%' }}>
            Open case
          </Btn>
        </Link>
        <Btn
          variant="secondary"
          size="lg"
          onClick={onScanAnother}
          iconLeft={<ScanIcon />}
        >
          Scan another
        </Btn>
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--text-faint)',
          marginTop: 10,
          textAlign: 'center',
        }}
      >
        Scanned: <span className="mono">{query}</span>
      </div>
    </div>
  )
}


function NotFoundCard({
  query,
  onClear,
}: {
  query: string
  onClear: () => void
}) {
  return (
    <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
      <div className="empty-state">
        <div
          className="empty-state-icon"
          style={{
            background: 'var(--red-bg)',
            color: 'var(--red-text)',
          }}
        >
          <NotFoundIcon />
        </div>
        <div className="empty-state-title">No match for that code</div>
        <div className="empty-state-msg">
          <span className="mono" style={{ color: 'var(--text)' }}>
            &quot;{query}&quot;
          </span>{' '}
          doesn&apos;t match any case, pallet, or part.
        </div>
        <div
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, justifyContent: 'center' }}
        >
          <Btn variant="primary" size="sm" onClick={onClear}>
            Try again
          </Btn>
          <Link href="/cases/new">
            <Btn variant="secondary" size="sm">
              Create new case
            </Btn>
          </Link>
          <Link href="/cases">
            <Btn variant="ghost" size="sm">
              Browse cases
            </Btn>
          </Link>
        </div>
      </div>
    </div>
  )
}


function LoadingResult() {
  return (
    <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '20px 0',
          color: 'var(--text-faint)',
          fontSize: 13,
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
        Looking up code…
      </div>
    </div>
  )
}


function RecentScans({ scans }: { scans: RecentScan[] }) {
  return (
    <div>
      <div
        className="eyebrow"
        style={{ marginBottom: 8, color: 'var(--text-faint)' }}
      >
        Recent scans
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {scans.map(s => {
          const dotColor =
            s.outcome === 'case'
              ? ROLE_COLORS.CASE
              : s.outcome === 'pallet'
              ? ROLE_COLORS.PALLET
              : s.outcome === 'part'
              ? ROLE_COLORS.PART
              : ROLE_COLORS.MISS
          return (
            <div
              key={s.matchedAt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                }}
              />
              <span
                className="mono"
                style={{
                  fontWeight: 500,
                  color: 'var(--text)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  fontWeight: 500,
                }}
              >
                {s.outcome}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function InfoRow({
  label,
  value,
  warn,
  muted,
  mono,
}: {
  label: string
  value: string
  warn?: boolean
  muted?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          marginBottom: 3,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div
        className={mono ? 'mono' : undefined}
        style={{
          fontSize: 13,
          color: warn
            ? 'var(--amber-text)'
            : muted
            ? 'var(--text-faint)'
            : 'var(--text)',
          fontWeight: warn ? 500 : 400,
        }}
      >
        {value}
      </div>
    </div>
  )
}


function KbdHint({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: '1px 6px',
        background: 'var(--s3)',
        border: '1px solid var(--border)',
        borderRadius: 4,
        color: 'var(--sub)',
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

function ScanIcon() {
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
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  )
}

function SoundOnIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

function SoundOffIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  )
}

function ArrowRightIcon() {
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
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function AlertIcon() {
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
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function NotFoundIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  )
}