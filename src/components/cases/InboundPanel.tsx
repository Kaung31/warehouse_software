'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'
import PhotoCapture, { type CapturedPhoto } from '@/components/ui/PhotoCapture'
import { uploadPhotos } from '@/lib/uploadPhotos'
import PaymentInfoBanner, { type PaymentInfo } from './PaymentInfoBanner'

/**
 * InboundPanel — warehouse intake + diagnosis for WARRANTY cases.
 *
 * v2 changes (April 2026):
 *   • Header is a clean .al-* alert (info / warn) instead of inline-styled
 *     box, depending on customer prepaid status. Tells the operator at a
 *     glance what to expect.
 *   • Scan input uses .scan-flash-success / .scan-flash-error animations
 *     from globals.css for visual confirmation. Border colour also turns
 *     green/red.
 *   • Camera button uses an SVG camera icon instead of the 📷 emoji.
 *   • Error codes use .filter-pill classes (consistent with cases page).
 *   • THREE action buttons (was two):
 *       1. Green primary — payment handled, send to mechanic
 *       2. Amber secondary — send to CS for payment confirmation
 *       3. NEW: Red danger inline form — "Send to CS for recharge"
 *          The path your spec described: when Inbound diagnoses and
 *          finds the scope is bigger than CS originally quoted, the
 *          case loops back to CS for re-quoting. Same pattern as the
 *          mechanic's recharge button.
 *   • Per-button loading flags (sendingMechanic / sendingCS / sendingRecharge)
 *     so buttons don't all disable together.
 *   • All emojis (✓ ✗ ⚡ → 📷) replaced with inline SVG.
 *   • Replaced inline-style sections with .eyebrow class.
 *   • Required field uses red dot indicator instead of "*".
 *
 * Backend: still uses /api/cases/[id]/inbound-triage for the
 * mechanic/CS paths. Recharge uses the same /escalate-to-cs endpoint
 * used by the mechanic.
 */

const ERROR_CODES = [
  { value: 'E01', label: 'E01 — No power' },
  { value: 'E02', label: 'E02 — Battery fault' },
  { value: 'E03', label: 'E03 — Motor fault' },
  { value: 'E04', label: 'E04 — Controller fault' },
  { value: 'E05', label: 'E05 — Throttle fault' },
  { value: 'E06', label: 'E06 — Brake fault' },
  { value: 'E07', label: 'E07 — Display fault' },
  { value: 'E08', label: 'E08 — Charger fault' },
  { value: 'E09', label: 'E09 — Wheel fault' },
  { value: 'E10', label: 'E10 — Light fault' },
  { value: 'PHYSICAL_CRACK',   label: 'Physical — Crack / Frame damage' },
  { value: 'PHYSICAL_BATTERY', label: 'Physical — Battery swelling / damage' },
  { value: 'PHYSICAL_WHEEL',   label: 'Physical — Wheel / Tyre damage' },
  { value: 'PHYSICAL_BRAKE',   label: 'Physical — Brake damage' },
  { value: 'PHYSICAL_DISPLAY', label: 'Physical — Display / Screen damage' },
  { value: 'OTHER',            label: 'Other — see diagnosis' },
]

const SAMPLE_CONDITION_PHOTOS = [
  { url: 'https://picsum.photos/seed/scooter1/200/200', caption: 'Front view' },
  { url: 'https://picsum.photos/seed/scooter2/200/200', caption: 'Damage area' },
  { url: 'https://picsum.photos/seed/scooter3/200/200', caption: 'Battery' },
]

type Props = {
  caseId: string
  serialNumber: string
  paymentInfo: PaymentInfo
}


export default function InboundPanel({
  caseId,
  serialNumber,
  paymentInfo,
}: Props) {
  const router = useRouter()

  // Scan state
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [scannedSerial, setScannedSerial] = useState('')
  const [scanStatus, setScanStatus] = useState<'idle' | 'match' | 'mismatch'>(
    'idle'
  )
  const [scanFlash, setScanFlash] = useState<'success' | 'error' | null>(null)

  // Photos
  const [conditionPhotos, setConditionPhotos] = useState<CapturedPhoto[]>([])

  // Form fields
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [diagnosis, setDiagnosis] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  // Recharge form
  const [rechargeReason, setRechargeReason] = useState('')

  // Per-action loading
  const [sendingMechanic, setSendingMechanic] = useState(false)
  const [sendingCS, setSendingCS] = useState(false)
  const [sendingRecharge, setSendingRecharge] = useState(false)
  const [error, setError] = useState('')

  function toggleCode(code: string) {
    setSelectedCodes(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  function handleScanInput(value: string) {
    setScannedSerial(value)
    if (!value.trim()) {
      setScanStatus('idle')
      setScanFlash(null)
      return
    }
    const match =
      value.trim().toUpperCase() === serialNumber.trim().toUpperCase()
    setScanStatus(match ? 'match' : 'mismatch')
    setScanFlash(match ? 'success' : 'error')
    // Clear flash class after animation completes
    setTimeout(() => setScanFlash(null), 600)
  }

  function handleScanEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleScanInput((e.target as HTMLInputElement).value)
    }
  }

  function validateBeforeSend(): boolean {
    if (scanStatus === 'mismatch') {
      setError('Scanned serial does not match this case — check the scooter')
      return false
    }
    if (selectedCodes.length === 0) {
      setError('Select at least one error code')
      return false
    }
    if (!diagnosis.trim()) {
      setError('Technical diagnosis is required')
      return false
    }
    return true
  }

  async function uploadPhotosIfAny() {
    if (conditionPhotos.length === 0) return
    const errs = await uploadPhotos(
      conditionPhotos,
      caseId,
      'RepairOrder',
      'SCOOTER_INBOUND'
    )
    if (errs.length > 0) {
      setError(`Triage saved, but ${errs.length} photo(s) failed to upload`)
    }
  }

  async function submitTriage(sendToMechanic: boolean) {
    if (!validateBeforeSend()) return
    const setBusy = sendToMechanic ? setSendingMechanic : setSendingCS
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/inbound-triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCodes: selectedCodes,
          diagnosis: diagnosis.trim(),
          internalNotes: internalNotes.trim() || undefined,
          sendToMechanic,
        }),
      })
      if (res.ok) {
        await uploadPhotosIfAny()
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to submit triage')
      }
    } finally {
      setBusy(false)
    }
  }

  async function sendToCSForRecharge() {
    if (!validateBeforeSend()) return
    if (!rechargeReason.trim()) {
      setError('Describe what scope you found that needs re-quoting')
      return
    }
    setSendingRecharge(true)
    setError('')
    try {
      // Step 1: Save the triage data (diagnosis + error codes + photos) so
      // CS can see the full context. This also moves status to AWAITING_CS.
      // We accept that this writes a status history entry — Step 2 will
      // overwrite/append the recharge-specific message after.
      const triageRes = await fetch(`/api/cases/${caseId}/inbound-triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorCodes: selectedCodes,
          diagnosis: diagnosis.trim(),
          internalNotes: internalNotes.trim() || undefined,
          sendToMechanic: false,
        }),
      })
      if (!triageRes.ok) {
        const b = await triageRes.json().catch(() => ({}))
        setError(b.error ?? 'Failed to save triage')
        return
      }
      await uploadPhotosIfAny()

      // Step 2: Escalate with the recharge reason + origin. The backend
      // should:
      //   - Save rechargeReason + rechargeOrigin + rechargeRequestedAt to
      //     the case (so CS sees the orange alert)
      //   - Write a status history entry with the proper recharge message
      //     ("Inbound found bigger scope — sent for recharge: ...")
      //
      // The reason includes both the scope description AND the diagnosis
      // so CS sees everything they need.
      const fullReason = diagnosis.trim()
        ? `${rechargeReason.trim()}\n\nInbound diagnosis: ${diagnosis.trim()}`
        : rechargeReason.trim()

      const escRes = await fetch(`/api/cases/${caseId}/escalate-to-cs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: fullReason,
          origin: 'INBOUND_DIAGNOSIS',
        }),
      })
      if (!escRes.ok) {
        const b = await escRes.json().catch(() => ({}))
        setError(b.error ?? 'Failed to escalate to CS')
        return
      }

      setRechargeReason('')
      router.refresh()
    } finally {
      setSendingRecharge(false)
    }
  }

  const anyBusy = sendingMechanic || sendingCS || sendingRecharge

  return (
    <form
      onSubmit={e => e.preventDefault()}
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      {/* ── Title ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Inbound triage
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          Receive, photograph, diagnose, and decide where to send next
        </div>
      </div>

      {/* ── Payment info banner ── */}
      <PaymentInfoBanner data={paymentInfo} />

      {/* ── QR / Barcode scan ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Scan scooter QR / barcode <RequiredDot />
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-faint)',
            marginBottom: 8,
            lineHeight: 1.5,
          }}
        >
          Scan the QR code or barcode to confirm the scooter matches this
          case. USB scanners type directly into the field — or use the camera
          button on mobile.
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'stretch',
          }}
        >
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={() => {
              setScanStatus('idle')
            }}
          />

          <input
            value={scannedSerial}
            onChange={e => handleScanInput(e.target.value)}
            onKeyDown={handleScanEnter}
            placeholder={`Expected: ${serialNumber}`}
            autoComplete="off"
            autoCapitalize="characters"
            className={
              scanFlash === 'success'
                ? 'mono scan-flash-success'
                : scanFlash === 'error'
                ? 'mono scan-flash-error'
                : 'mono'
            }
            style={{
              flex: 1,
              letterSpacing: '0.05em',
              borderColor:
                scanStatus === 'match'
                  ? 'var(--green)'
                  : scanStatus === 'mismatch'
                  ? 'var(--red)'
                  : undefined,
            }}
          />

          <button
            type="button"
            title="Use camera to scan QR"
            aria-label="Open camera"
            onClick={() => cameraInputRef.current?.click()}
            className="btn-icon"
            style={{ flexShrink: 0 }}
          >
            <Icon name="camera" size={15} />
          </button>
        </div>

        {/* Scan feedback */}
        {scanStatus === 'match' && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: 'var(--green-text)',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon name="check" size={12} />
            Serial confirmed — scooter matches this case
          </div>
        )}
        {scanStatus === 'mismatch' && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: 'var(--red-text)',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon name="x" size={12} />
            Serial mismatch — scanned: {scannedSerial.toUpperCase()}, expected:{' '}
            <span className="mono">{serialNumber}</span>
          </div>
        )}
        {scanStatus === 'idle' && scannedSerial === '' && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: 'var(--text-faint)',
            }}
          >
            Scan with a USB barcode scanner or use the camera on mobile
          </div>
        )}
      </div>

      {/* ── Condition photos ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Condition photos on arrival
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-faint)',
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          Photograph the scooter as received — capture any visible damage
          before work begins.
        </div>
        <PhotoCapture
          label="Arrival condition photos"
          photos={conditionPhotos}
          onChange={setConditionPhotos}
          maxPhotos={8}
          samplePhotos={SAMPLE_CONDITION_PHOTOS}
        />
      </div>

      {/* ── Error codes ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Error codes <RequiredDot />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ERROR_CODES.map(ec => {
            const sel = selectedCodes.includes(ec.value)
            return (
              <button
                key={ec.value}
                type="button"
                onClick={() => toggleCode(ec.value)}
                className={`filter-pill${sel ? ' on' : ''}`}
                disabled={anyBusy}
              >
                {ec.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Diagnosis + notes ── */}
      <div>
        <label htmlFor="diagnosis">
          Technical diagnosis <RequiredDot />
        </label>
        <textarea
          id="diagnosis"
          rows={4}
          value={diagnosis}
          onChange={e => setDiagnosis(e.target.value)}
          placeholder="Describe what the inbound team found upon physical inspection…"
          required
          style={{ resize: 'vertical' }}
          disabled={anyBusy}
        />
      </div>

      <div>
        <label htmlFor="internal-notes">Internal notes</label>
        <input
          id="internal-notes"
          value={internalNotes}
          onChange={e => setInternalNotes(e.target.value)}
          placeholder="Any notes for CS or the mechanic…"
          disabled={anyBusy}
        />
      </div>

      {error && (
        <div className="al al-d" style={{ marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          paddingTop: 4,
          borderTop: '1px solid var(--border)',
          marginTop: 4,
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Where next?
        </div>

        {/* Path 1: Send to mechanic */}
        <Btn
          variant="primary"
          size="lg"
          loading={sendingMechanic}
          disabled={sendingCS || sendingRecharge}
          onClick={() => submitTriage(true)}
          iconLeft={<Icon name="bolt" size={14} />}
        >
          Payment handled — send to mechanic
        </Btn>

        {/* Path 2: Send to CS for confirmation */}
        <Btn
          variant="secondary"
          loading={sendingCS}
          disabled={sendingMechanic || sendingRecharge}
          onClick={() => submitTriage(false)}
          iconLeft={<Icon name="arrow-right" size={13} />}
        >
          Send to CS for payment confirmation
        </Btn>

        {/* Path 3: Recharge (when scope is bigger than CS quoted) */}
        <div
          style={{
            padding: '10px 12px',
            background: 'var(--red-bg)',
            border: '1px solid var(--red-b)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--red-text)',
              marginBottom: 4,
            }}
          >
            <Icon name="refresh" size={12} />
            Found bigger scope than CS quoted?
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--red-text)',
              opacity: 0.85,
              marginBottom: 6,
              lineHeight: 1.5,
            }}
          >
            If your diagnosis reveals more damage than CS originally charged
            for, send back to CS for re-quoting. The customer will be re-quoted
            before the repair starts.
          </div>
          <input
            value={rechargeReason}
            onChange={e => setRechargeReason(e.target.value)}
            placeholder="What did you find? (e.g. battery damaged, deck cracked)"
            style={{ marginBottom: 6 }}
            disabled={anyBusy}
          />
          <Btn
            variant="danger"
            size="sm"
            loading={sendingRecharge}
            disabled={sendingMechanic || sendingCS}
            onClick={sendToCSForRecharge}
            iconLeft={<Icon name="refresh" size={12} />}
          >
            Send to CS for recharge
          </Btn>
        </div>

        <div
          style={{
            fontSize: 11,
            color: 'var(--text-faint)',
            marginTop: 4,
          }}
        >
          Choose based on whether payment, approval, and scope are fully sorted.
        </div>
      </div>
    </form>
  )
}


/* ─── Helpers ──────────────────────────────────────────────────────── */

function RequiredDot() {
  return (
    <span
      aria-label="required"
      style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: 'var(--red)',
        marginLeft: 4,
        verticalAlign: 'middle',
      }}
    />
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName =
  | 'check'
  | 'x'
  | 'alert'
  | 'camera'
  | 'bolt'
  | 'arrow-right'
  | 'refresh'

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
    case 'x':
      return (
        <svg {...p} strokeWidth="2">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
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
    case 'camera':
      return (
        <svg {...p}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      )
    case 'bolt':
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...p}>
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
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
    default:
      return null
  }
}