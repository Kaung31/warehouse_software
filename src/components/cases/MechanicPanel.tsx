'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'
import PaymentInfoBanner, { type PaymentInfo } from './PaymentInfoBanner'

/**
 * MechanicPanel — workbench panel for WARRANTY repairs.
 *
 * B-Grade cases use a separate `BgradeMechanicPanel` because their
 * workflow is fundamentally different (assessment + grading, not fix-it).
 * Don't merge them — the separation keeps both files clear.
 *
 * v2 changes (April 2026):
 *   • Live-ticking timer (refreshes every second). Renders as big mono
 *     number in the dark hero header so mechanics can see elapsed time
 *     at a glance from across the workshop.
 *   • Compatible parts panel redesigned: clean rows with prominent
 *     BIN LOCATION pill (e.g. "PART-S2-RA-B5"). Mechanics walk to that
 *     location to grab the part — making it the most visible field is
 *     the single biggest productivity win.
 *   • Stock count uses traffic-light colors (green / amber / red) and
 *     "Log" button auto-disables when stock is 0.
 *   • Logged parts as compact green check rows with quantity badges.
 *   • Per-action loading flags (assigning / starting / completing /
 *     awaitingPartsBusy / resuming / escalating / addingPart) so
 *     buttons don't all disable together.
 *   • All emojis (▶ ⏳ ↩ ✓) replaced with inline SVG.
 *   • Action section restructured: green "Complete repair" big button
 *     + amber "Pause for parts" inline form + red "Send back to CS for
 *     recharge" inline form with explanation copy matching the
 *     CS_RECHARGE workflow.
 *
 * No backend changes — uses /assign-mechanic, /start-repair,
 * /complete-repair, /awaiting-parts, /escalate-to-cs, /repairs/[id]/parts.
 */

type Part = {
  id: string
  name: string
  sku: string
  barcode: string | null
  stockQty: number
  unitCost: unknown
  warehouseLocation: string | null
  compatibleModels: string | null
}
type RepairPart = { quantity: number; part: Part }
type Mechanic = { id: string; name: string; role: string }

type Props = {
  caseId: string
  status: string
  startedAt: string | null
  repairParts: RepairPart[]
  userRole: string
  mechanicId?: string | null
  scooterModel?: string
  paymentInfo: PaymentInfo
  /** Kept for compat — should always be 'WARRANTY' here.
   *  BGRADE cases route to BgradeMechanicPanel instead. */
  caseType?: string
}

export default function MechanicPanel({
  caseId,
  status,
  startedAt,
  repairParts,
  userRole,
  mechanicId,
  scooterModel,
  paymentInfo,
}: Props) {
  const router = useRouter()

  // Mechanic assignment
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [selectedMechanicId, setSelectedMechanicId] = useState(mechanicId ?? '')

  // Repair fields
  const [diagnosis, setDiagnosis] = useState('')
  const [resolution, setResolution] = useState('')
  const [repairNotes, setRepairNotes] = useState('')

  // Per-action loading flags
  const [assigning, setAssigning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [awaitingPartsBusy, setAwaitingPartsBusy] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [addingPart, setAddingPart] = useState(false)
  const [error, setError] = useState('')
  const [assignError, setAssignError] = useState('')

  // Parts picker
  const [availableParts, setAvailableParts] = useState<Part[]>([])
  const [partSearch, setPartSearch] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)

  // Optional fields
  const [partsNote, setPartsNote] = useState('')
  const [escalateReason, setEscalateReason] = useState('')

  const isWaiting = status === 'WAITING_FOR_MECHANIC'
  const isInRepair = status === 'IN_REPAIR'
  const isQcFailed = status === 'QC_FAILED'
  const isAwaitingParts = status === 'AWAITING_PARTS'
  const canAct = ['ADMIN', 'MANAGER', 'MECHANIC'].includes(userRole)

  /* ─── Live-ticking elapsed time ──────────────────────────────────── */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isInRepair || !startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isInRepair, startedAt])

  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
    : null

  /* ─── Fetch mechanics ────────────────────────────────────────────── */
  useEffect(() => {
    if (!isWaiting) return
    fetch('/api/users?role=MECHANIC')
      .then(r => r.json())
      .then(d => setMechanics(Array.isArray(d.data) ? d.data : []))
      .catch(() => setMechanics([]))
  }, [isWaiting])

  /* ─── Fetch parts (model-filtered when known) ────────────────────── */
  useEffect(() => {
    if (!isInRepair && !isAwaitingParts) return
    const url = scooterModel
      ? `/api/parts?model=${encodeURIComponent(scooterModel)}&pageSize=100`
      : '/api/parts?pageSize=100'
    fetch(url)
      .then(r => r.json())
      .then(d => setAvailableParts(Array.isArray(d.data?.parts) ? d.data.parts : []))
      .catch(() => setAvailableParts([]))
  }, [isInRepair, isAwaitingParts, scooterModel])

  /* ─── Actions ────────────────────────────────────────────────────── */

  async function assignMechanic() {
    if (!selectedMechanicId) {
      setAssignError('Select a mechanic first')
      return
    }
    setAssigning(true)
    setAssignError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/assign-mechanic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mechanicId: selectedMechanicId }),
      })
      if (res.ok) router.refresh()
      else {
        const b = await res.json().catch(() => ({}))
        setAssignError(b.error ?? 'Failed to assign mechanic')
      }
    } finally {
      setAssigning(false)
    }
  }

  async function startRepair() {
    setStarting(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/start-repair`, {
        method: 'POST',
      })
      if (res.ok) router.refresh()
      else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to start repair')
      }
    } finally {
      setStarting(false)
    }
  }

  async function completeRepair() {
    if (!diagnosis.trim()) {
      setError('Diagnosis is required before completing')
      return
    }
    setCompleting(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/complete-repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagnosis: diagnosis.trim(),
          resolution: resolution.trim() || undefined,
          repairNotes: repairNotes.trim() || undefined,
        }),
      })
      if (res.ok) router.refresh()
      else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to complete repair')
      }
    } finally {
      setCompleting(false)
    }
  }

  async function markAwaitingParts() {
    setAwaitingPartsBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/awaiting-parts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partsNote: partsNote.trim() || undefined }),
      })
      if (res.ok) {
        setPartsNote('')
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to update status')
      }
    } finally {
      setAwaitingPartsBusy(false)
    }
  }

  async function resumeRepair() {
    setResuming(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/awaiting-parts`, {
        method: 'DELETE',
      })
      if (res.ok) router.refresh()
      else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to resume repair')
      }
    } finally {
      setResuming(false)
    }
  }

  async function addPart(partIdOverride?: string) {
    const partId =
      partIdOverride ||
      selectedPartId ||
      availableParts.find(
        p =>
          p.sku.toLowerCase() === partSearch.toLowerCase() ||
          p.barcode?.toLowerCase() === partSearch.toLowerCase()
      )?.id
    if (!partId) {
      setError('Select a part or enter a matching SKU / barcode')
      return
    }
    setAddingPart(true)
    setError('')
    try {
      const res = await fetch(`/api/repairs/${caseId}/parts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partId, quantity: 1 }),
      })
      if (res.ok) {
        setSelectedPartId('')
        setPartSearch('')
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to add part')
      }
    } finally {
      setAddingPart(false)
    }
  }

  async function escalateToCS() {
    if (!escalateReason.trim()) {
      setError('Provide a reason for sending back to CS')
      return
    }
    setEscalating(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/escalate-to-cs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: escalateReason.trim(),
          origin: 'MECHANIC_REPAIR',
        }),
      })
      if (res.ok) {
        setEscalateReason('')
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to escalate')
      }
    } finally {
      setEscalating(false)
    }
  }

  /* ─── Render ─────────────────────────────────────────────────────── */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Payment info banner ── */}
      <PaymentInfoBanner data={paymentInfo} />

      {/* ── Title ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Mechanic workbench
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          {isWaiting && 'Assign a mechanic and start the repair'}
          {isInRepair && 'Repair in progress'}
          {isAwaitingParts && 'Repair paused — awaiting spare parts'}
          {isQcFailed && 'QC failed — restart repair to address issues'}
        </div>
      </div>

      {/* ── Live timer (when in repair) ── */}
      {isInRepair && elapsedSec != null && (
        <div
          style={{
            padding: '14px 18px',
            background: 'linear-gradient(135deg, #042C53 0%, #0a3a6b 100%)',
            color: '#fff',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.10)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="wrench" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                color: '#85B7EB',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              Repair timer
            </div>
            <div
              className="mono"
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '-.02em',
                lineHeight: 1,
              }}
            >
              {formatTimer(elapsedSec)}
            </div>
          </div>
          <span
            className="led"
            style={{ background: '#22d374', width: 9, height: 9 }}
          />
        </div>
      )}

      {/* ─── WAITING_FOR_MECHANIC: assign + start ─── */}
      {isWaiting && canAct && (
        <div
          style={{
            padding: 16,
            background: 'var(--s2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Assign mechanic
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--sub)',
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Select which mechanic will handle this repair. You can assign
            yourself or another team member.
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <select
              value={selectedMechanicId}
              onChange={e => setSelectedMechanicId(e.target.value)}
              style={{ flex: 1, minWidth: 160 }}
            >
              <option value="">— Select mechanic —</option>
              {mechanics.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              {mechanics.length === 0 && (
                <option disabled>Loading mechanics…</option>
              )}
            </select>

            <Btn
              variant="secondary"
              size="sm"
              loading={assigning}
              disabled={!selectedMechanicId}
              onClick={assignMechanic}
            >
              Assign
            </Btn>
          </div>

          {assignError && (
            <div className="al al-d" style={{ marginTop: 10, marginBottom: 0 }}>
              {assignError}
            </div>
          )}

          <div
            style={{
              marginTop: 14,
              borderTop: '1px solid var(--border)',
              paddingTop: 12,
            }}
          >
            <div
              style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8 }}
            >
              Once assigned, start the repair timer:
            </div>
            <Btn
              variant="primary"
              size="lg"
              loading={starting}
              onClick={startRepair}
              iconLeft={<Icon name="play" size={14} />}
            >
              Start repair
            </Btn>
          </div>
        </div>
      )}

      {/* ─── QC_FAILED: restart ─── */}
      {isQcFailed && canAct && (
        <Btn
          variant="primary"
          size="lg"
          loading={starting}
          onClick={startRepair}
          iconLeft={<Icon name="refresh" size={14} />}
        >
          Restart repair (QC failed)
        </Btn>
      )}

      {/* ─── AWAITING_PARTS: resume button ─── */}
      {isAwaitingParts && canAct && (
        <div
          style={{
            padding: 16,
            background: 'var(--amber-bg)',
            border: '1px solid var(--amber-b)',
            borderRadius: 'var(--radius)',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--amber-text)',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="hourglass" size={14} />
            Waiting for spare parts
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--amber-text)',
              marginBottom: 12,
              opacity: 0.85,
              lineHeight: 1.5,
            }}
          >
            Repair is on hold until parts arrive. Click below when parts are in
            stock.
          </div>
          <Btn
            variant="primary"
            loading={resuming}
            onClick={resumeRepair}
            iconLeft={<Icon name="play" size={13} />}
          >
            Parts arrived — Resume repair
          </Btn>
        </div>
      )}

      {/* ─── Compatible parts catalog ─── */}
      {(isInRepair || isAwaitingParts) && availableParts.length > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <div className="eyebrow">
              {scooterModel
                ? `Compatible parts — ${scooterModel}`
                : 'Available parts'}
            </div>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--sub)' }}
            >
              {availableParts.length} available
            </span>
          </div>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            {availableParts.map((p, i) => {
              const stockTone =
                p.stockQty <= 0
                  ? 'var(--red-text)'
                  : p.stockQty <= 2
                  ? 'var(--amber-text)'
                  : 'var(--green-text)'
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderBottom:
                      i < availableParts.length - 1
                        ? '1px solid var(--border)'
                        : 'none',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {p.name}
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--sub)',
                      }}
                    >
                      {p.sku}
                    </span>
                  </div>
                  {p.warehouseLocation ? (
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        background: 'var(--accent-dim)',
                        color: 'var(--accent-text)',
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-sm)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title="Bin location"
                    >
                      <Icon name="pin" size={11} />
                      {p.warehouseLocation}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      —
                    </span>
                  )}
                  <span
                    className="mono"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: stockTone,
                      minWidth: 30,
                      textAlign: 'right',
                    }}
                    title={`${p.stockQty} in stock`}
                  >
                    {p.stockQty}
                  </span>
                  <Btn
                    variant="secondary"
                    size="sm"
                    disabled={p.stockQty <= 0 || addingPart}
                    onClick={() => addPart(p.id)}
                  >
                    Log
                  </Btn>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Logged parts on this repair ─── */}
      {(isInRepair || isAwaitingParts) && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <div className="eyebrow">Parts used on this repair</div>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--sub)' }}
            >
              {repairParts.length} item{repairParts.length === 1 ? '' : 's'}
            </span>
          </div>

          {repairParts.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-faint)',
                fontStyle: 'italic',
                padding: '8px 0',
              }}
            >
              No parts logged yet — scan a barcode below or click &quot;Log&quot; on a part above.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                marginBottom: 10,
              }}
            >
              {repairParts.map((rp, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 13,
                    padding: '8px 12px',
                    background: 'var(--green-bg)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--green-b)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--green-text)',
                        display: 'inline-flex',
                      }}
                    >
                      <Icon name="check" size={13} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <span
                        style={{
                          color: 'var(--text)',
                          fontWeight: 500,
                        }}
                      >
                        {rp.part.name}
                      </span>
                      {rp.part.warehouseLocation && (
                        <span
                          className="mono"
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            color: 'var(--sub)',
                          }}
                        >
                          {rp.part.warehouseLocation}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="mono"
                    style={{
                      color: 'var(--green-text)',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    ×{rp.quantity}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Barcode scanner / search */}
          <div className="sbar">
            <span className="led" />
            <input
              ref={scanInputRef}
              value={partSearch}
              onChange={e => {
                setPartSearch(e.target.value)
                setSelectedPartId('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addPart()
                }
              }}
              placeholder="Scan barcode or type SKU / name — Enter to log"
              autoComplete="off"
            />
          </div>

          {partSearch && (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface)',
                maxHeight: 200,
                overflowY: 'auto',
                marginTop: 4,
              }}
            >
              {availableParts
                .filter(
                  p =>
                    p.name.toLowerCase().includes(partSearch.toLowerCase()) ||
                    p.sku.toLowerCase().includes(partSearch.toLowerCase()) ||
                    (p.barcode ?? '')
                      .toLowerCase()
                      .includes(partSearch.toLowerCase())
                )
                .slice(0, 10)
                .map(p => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setSelectedPartId(p.id)
                      setPartSearch(p.name)
                    }}
                    style={{
                      padding: '9px 12px',
                      cursor: 'pointer',
                      fontSize: 12,
                      background:
                        selectedPartId === p.id
                          ? 'var(--accent-dim)'
                          : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 500, color: 'var(--text)' }}>
                        {p.name}
                      </span>
                      <span
                        className="mono"
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: 'var(--sub)',
                        }}
                      >
                        {p.sku}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {p.warehouseLocation && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: 'var(--accent-text)',
                            background: 'var(--accent-dim)',
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          {p.warehouseLocation}
                        </span>
                      )}
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color:
                            p.stockQty <= 0
                              ? 'var(--red-text)'
                              : 'var(--green-text)',
                        }}
                      >
                        {p.stockQty}
                      </span>
                    </div>
                  </div>
                ))}
              {availableParts.filter(
                p =>
                  p.name.toLowerCase().includes(partSearch.toLowerCase()) ||
                  p.sku.toLowerCase().includes(partSearch.toLowerCase()) ||
                  (p.barcode ?? '')
                    .toLowerCase()
                    .includes(partSearch.toLowerCase())
              ).length === 0 && (
                <div
                  style={{
                    padding: '12px 14px',
                    fontSize: 12,
                    color: 'var(--sub)',
                  }}
                >
                  No parts match &quot;{partSearch}&quot;
                </div>
              )}
            </div>
          )}

          <Btn
            variant="secondary"
            size="sm"
            loading={addingPart}
            disabled={!selectedPartId && !partSearch.trim()}
            onClick={() => addPart()}
            iconLeft={<Icon name="plus" size={13} />}
          >
            Log part as used
          </Btn>
        </div>
      )}

      {/* ─── Repair notes (during repair) ─── */}
      {(isInRepair || isAwaitingParts) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            paddingTop: 4,
          }}
        >
          <div className="eyebrow">Repair notes</div>

          <div>
            <label htmlFor="diagnosis">
              Diagnosis <RequiredDot />
            </label>
            <textarea
              id="diagnosis"
              rows={3}
              value={diagnosis}
              onChange={e => setDiagnosis(e.target.value)}
              placeholder="What was the root cause?"
              style={{ resize: 'vertical' }}
            />
          </div>
          <div>
            <label htmlFor="resolution">Resolution</label>
            <textarea
              id="resolution"
              rows={2}
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              placeholder="What was done to fix it?"
              style={{ resize: 'vertical' }}
            />
          </div>
          <div>
            <label htmlFor="repair-notes">Additional notes</label>
            <textarea
              id="repair-notes"
              rows={2}
              value={repairNotes}
              onChange={e => setRepairNotes(e.target.value)}
              placeholder="Any other notes…"
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="al al-d" style={{ marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* ─── Action buttons (during repair) ─── */}
      {isInRepair && canAct && (
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
            Actions
          </div>

          <Btn
            variant="success"
            size="lg"
            loading={completing}
            disabled={awaitingPartsBusy || escalating || addingPart}
            onClick={completeRepair}
            iconLeft={<Icon name="check" size={14} />}
          >
            Complete repair — send to QC
          </Btn>

          {/* Awaiting parts */}
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--amber-bg)',
              border: '1px solid var(--amber-b)',
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
                color: 'var(--amber-text)',
                marginBottom: 6,
              }}
            >
              <Icon name="hourglass" size={12} />
              Pause for parts
            </div>
            <input
              value={partsNote}
              onChange={e => setPartsNote(e.target.value)}
              placeholder="Which parts are needed? (optional)"
              style={{ marginBottom: 6 }}
            />
            <Btn
              variant="warning"
              size="sm"
              loading={awaitingPartsBusy}
              disabled={completing || escalating}
              onClick={markAwaitingParts}
              iconLeft={<Icon name="hourglass" size={12} />}
            >
              Mark as awaiting parts
            </Btn>
          </div>

          {/* Send to CS for recharge */}
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
              Send back to CS for recharge
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
              Use when you find additional damage or work that wasn&apos;t in
              the original quote. The case will pause and CS will re-quote the
              customer.
            </div>
            <input
              value={escalateReason}
              onChange={e => setEscalateReason(e.target.value)}
              placeholder="What did you find? (e.g. cracked deck — needs replacement)"
              style={{ marginBottom: 6 }}
            />
            <Btn
              variant="danger"
              size="sm"
              loading={escalating}
              disabled={completing || awaitingPartsBusy}
              onClick={escalateToCS}
              iconLeft={<Icon name="refresh" size={12} />}
            >
              Send to CS for recharge
            </Btn>
          </div>
        </div>
      )}
    </div>
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

function formatTimer(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  }
  return `${m}m ${String(s).padStart(2, '0')}s`
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName =
  | 'play'
  | 'check'
  | 'refresh'
  | 'hourglass'
  | 'wrench'
  | 'pin'
  | 'plus'

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
    case 'play':
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p} strokeWidth="2">
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
    case 'hourglass':
      return (
        <svg {...p}>
          <path d="M5 22h14" />
          <path d="M5 2h14" />
          <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
        </svg>
      )
    case 'wrench':
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    case 'pin':
      return (
        <svg {...p}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
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