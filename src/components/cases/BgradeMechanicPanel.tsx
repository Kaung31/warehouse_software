'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * BgradeMechanicPanel — workbench panel for B-GRADE assessment cases.
 *
 * Different from warranty MechanicPanel because B-Grade is an
 * ASSESSMENT workflow, not a fix-it workflow:
 *   • No customer relationship → no CS recharge loop
 *   • These are returns from retailers (Currys, Argos, John Lewis…)
 *   • Grade (A/B/C) is MANDATORY before completion
 *   • Mileage is MANDATORY before completion
 *   • Final action label is "Complete Assessment → QC", not "Repair"
 *
 * v2 changes (April 2026):
 *   • Live-ticking timer in the dark hero header (matches warranty panel
 *     for visual consistency).
 *   • Big color-coded grade buttons (60px tall, A green / B amber / C
 *     red) — the headline interaction. Clicking sets the grade with
 *     unmistakable visual feedback.
 *   • Pre-filled values from the scooter record (colour, mileage, grade)
 *     show as default but stay editable.
 *   • Compatible parts catalog with prominent BIN LOCATION pills
 *     (matches MechanicPanel).
 *   • Per-action loading flags so buttons don't all disable together.
 *   • All inline-style hacks replaced with .eyebrow / .ir / .qci
 *     classes from globals.css.
 *   • All emojis (⏱) replaced with inline SVG.
 *   • Validation: grade + mileage required; clear error if missing.
 *
 * No backend changes — uses /assign-mechanic, /start-repair,
 * /complete-repair, /awaiting-parts, /repairs/[id]/parts.
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
  scooterColour?: string | null
  scooterGrade?: string | null
  scooterMileage?: number | null
  /** Retailer source — Currys, Argos, John Lewis, etc. */
  source?: string | null
}

export default function BgradeMechanicPanel({
  caseId,
  status,
  startedAt,
  repairParts,
  userRole,
  mechanicId,
  scooterModel,
  scooterColour,
  scooterGrade,
  scooterMileage,
  source,
}: Props) {
  const router = useRouter()

  // Mechanic assignment
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [selectedMechanicId, setSelectedMechanicId] = useState(mechanicId ?? '')

  // Assessment fields (pre-filled from scooter record)
  const [diagnosis, setDiagnosis] = useState('')
  const [repairNotes, setRepairNotes] = useState('')
  const [bgColour, setBgColour] = useState(scooterColour ?? '')
  const [bgMileage, setBgMileage] = useState(
    scooterMileage ? String(scooterMileage) : ''
  )
  const [bgGrade, setBgGrade] = useState<'A' | 'B' | 'C' | ''>(
    (scooterGrade as 'A' | 'B' | 'C' | null) ?? ''
  )

  // Per-action loading
  const [assigning, setAssigning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [awaitingPartsBusy, setAwaitingPartsBusy] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [addingPart, setAddingPart] = useState(false)
  const [error, setError] = useState('')
  const [assignError, setAssignError] = useState('')

  // Parts picker
  const [availableParts, setAvailableParts] = useState<Part[]>([])
  const [partSearch, setPartSearch] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)

  const [partsNote, setPartsNote] = useState('')

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

  /* ─── Fetch parts ────────────────────────────────────────────────── */
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
        setError(b.error ?? 'Failed to start assessment')
      }
    } finally {
      setStarting(false)
    }
  }

  async function completeAssessment() {
    if (!bgGrade) {
      setError('Pick a grade (A / B / C) before completing')
      return
    }
    if (!bgMileage) {
      setError('Mileage is required before completing')
      return
    }
    setCompleting(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/complete-repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagnosis: diagnosis.trim() || 'B-Grade assessment',
          resolution: 'Graded and recorded',
          repairNotes: repairNotes.trim() || undefined,
          colour: bgColour.trim() || undefined,
          totalMileage: bgMileage ? parseInt(bgMileage, 10) : undefined,
          grade: bgGrade,
        }),
      })
      if (res.ok) router.refresh()
      else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to complete assessment')
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
        setError(b.error ?? 'Failed to resume')
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

  /* ─── Render ─────────────────────────────────────────────────────── */

  if (!canAct) {
    return (
      <div
        style={{
          padding: '24px 0',
          textAlign: 'center',
          color: 'var(--text-faint)',
          fontSize: 13,
        }}
      >
        No action required for your role at this stage.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Title ── */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          B-Grade assessment
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          {isWaiting && 'Assign a mechanic to begin assessment'}
          {isInRepair && 'Assessment in progress — grade and record mileage'}
          {isAwaitingParts && 'Assessment paused — awaiting parts'}
          {isQcFailed && 'QC failed — re-assess'}
        </div>
        {source && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--sub)',
              marginTop: 4,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
            }}
          >
            Source: {source}
          </div>
        )}
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
            <Icon name="clock" size={18} />
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
              Assessment timer
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

      {/* ─── WAITING_FOR_MECHANIC ─── */}
      {isWaiting && (
        <div
          style={{
            padding: 16,
            background: 'var(--s2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'var(--sub)',
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Assign a mechanic to begin the B-Grade assessment.
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
              onChange={e => {
                setSelectedMechanicId(e.target.value)
                setAssignError('')
              }}
              style={{ flex: 1, minWidth: 160 }}
            >
              <option value="">— Select mechanic —</option>
              {mechanics.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <Btn
              variant="primary"
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
            <Btn
              variant="primary"
              size="lg"
              loading={starting}
              onClick={startRepair}
              iconLeft={<Icon name="play" size={14} />}
            >
              Start assessment
            </Btn>
          </div>
        </div>
      )}

      {/* ─── QC_FAILED: re-assess ─── */}
      {isQcFailed && (
        <Btn
          variant="primary"
          size="lg"
          loading={starting}
          onClick={startRepair}
          iconLeft={<Icon name="refresh" size={14} />}
        >
          Re-assess (QC failed)
        </Btn>
      )}

      {/* ─── AWAITING_PARTS ─── */}
      {isAwaitingParts && (
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
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="hourglass" size={14} />
            Waiting for parts. Resume when parts arrive.
          </div>
          <Btn
            variant="primary"
            loading={resuming}
            onClick={resumeRepair}
            iconLeft={<Icon name="play" size={13} />}
          >
            Parts arrived — Resume assessment
          </Btn>
        </div>
      )}

      {/* ─── Grade + colour + mileage (when in repair) ─── */}
      {(isInRepair || isAwaitingParts) && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Grade assessment
          </div>

          {/* Big color-coded grade buttons (64px tall) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              marginBottom: 14,
            }}
          >
            <GradeButton
              grade="A"
              label="Excellent"
              tone="green"
              active={bgGrade === 'A'}
              onClick={() => setBgGrade(bgGrade === 'A' ? '' : 'A')}
            />
            <GradeButton
              grade="B"
              label="Good"
              tone="amber"
              active={bgGrade === 'B'}
              onClick={() => setBgGrade(bgGrade === 'B' ? '' : 'B')}
            />
            <GradeButton
              grade="C"
              label="Fair"
              tone="red"
              active={bgGrade === 'C'}
              onClick={() => setBgGrade(bgGrade === 'C' ? '' : 'C')}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <div>
              <label htmlFor="bg-colour">Colour</label>
              <input
                id="bg-colour"
                value={bgColour}
                onChange={e => setBgColour(e.target.value)}
                placeholder="e.g. Black, White, Red"
              />
            </div>
            <div>
              <label htmlFor="bg-mileage">
                Mileage (km) <RequiredDot />
              </label>
              <input
                id="bg-mileage"
                type="number"
                inputMode="numeric"
                min="0"
                value={bgMileage}
                onChange={e => setBgMileage(e.target.value)}
                placeholder="e.g. 1200"
                className="mono"
              />
            </div>
          </div>
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
                      style={{ fontSize: 11, color: 'var(--sub)' }}
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

      {/* ─── Parts used / scan bar ─── */}
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
            <div className="eyebrow">Parts / replacements</div>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--sub)' }}
            >
              {repairParts.length} item{repairParts.length === 1 ? '' : 's'}
            </span>
          </div>

          {repairParts.length > 0 && (
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
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                      {rp.part.name}
                    </span>
                    {rp.part.warehouseLocation && (
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: 'var(--sub)' }}
                      >
                        {rp.part.warehouseLocation}
                      </span>
                    )}
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
                ))}
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

      {/* ─── Technician notes ─── */}
      {(isInRepair || isAwaitingParts) && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Technician notes
          </div>
          <textarea
            placeholder="Condition notes, issues found, cosmetic damage…"
            value={diagnosis}
            onChange={e => setDiagnosis(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', marginBottom: 8 }}
          />
          <textarea
            placeholder="Internal notes (optional)"
            value={repairNotes}
            onChange={e => setRepairNotes(e.target.value)}
            rows={2}
            style={{ resize: 'vertical' }}
          />
        </div>
      )}

      {error && (
        <div className="al al-d" style={{ marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* ─── Actions (during assessment) ─── */}
      {isInRepair && (
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
            disabled={awaitingPartsBusy || addingPart}
            onClick={completeAssessment}
            iconLeft={<Icon name="check" size={14} />}
          >
            Complete assessment — send to QC
          </Btn>

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
              disabled={completing}
              onClick={markAwaitingParts}
              iconLeft={<Icon name="hourglass" size={12} />}
            >
              Mark as awaiting parts
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function GradeButton({
  grade,
  label,
  tone,
  active,
  onClick,
}: {
  grade: 'A' | 'B' | 'C'
  label: string
  tone: 'green' | 'amber' | 'red'
  active: boolean
  onClick: () => void
}) {
  const styles =
    tone === 'green'
      ? {
          bg: active ? 'var(--green-bg)' : 'var(--surface)',
          border: active ? 'var(--green)' : 'var(--border)',
          color: active ? 'var(--green-text)' : 'var(--text)',
          gradeBg: 'var(--green)',
        }
      : tone === 'amber'
      ? {
          bg: active ? 'var(--amber-bg)' : 'var(--surface)',
          border: active ? 'var(--amber)' : 'var(--border)',
          color: active ? 'var(--amber-text)' : 'var(--text)',
          gradeBg: 'var(--amber)',
        }
      : {
          bg: active ? 'var(--red-bg)' : 'var(--surface)',
          border: active ? 'var(--red)' : 'var(--border)',
          color: active ? 'var(--red-text)' : 'var(--text)',
          gradeBg: 'var(--red)',
        }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 64,
        padding: '8px 10px',
        background: styles.bg,
        border: `2px solid ${styles.border}`,
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        transition: 'all .15s',
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: active ? styles.gradeBg : 'var(--s3)',
          color: active ? '#fff' : 'var(--sub)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {grade}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: styles.color,
        }}
      >
        {label}
      </span>
    </button>
  )
}

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
  | 'clock'
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
    case 'clock':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
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