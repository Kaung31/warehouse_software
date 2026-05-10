'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * JobActionBar — sticky bottom action bar for /workshop/job/[id].
 *
 * Three actions, all gated to status = IN_REPAIR (the API endpoints
 * enforce this anyway, but disabling the buttons up front is friendlier):
 *
 *   1. Pause for parts → PUT  /api/cases/[id]/awaiting-parts
 *      - Inline form: optional "what part(s)" note.
 *      - The endpoint clears mechanicId and moves status to
 *        AWAITING_PARTS, so the case leaves this mechanic's queue.
 *        When parts arrive and the case is moved back to
 *        WAITING_FOR_MECHANIC, any mechanic can re-claim it.
 *
 *   2. Send to CS for recharge → POST /api/cases/[id]/escalate-to-cs
 *      - Inline form: required "why" reason. Origin is auto-detected
 *        from current status by the endpoint, so we don't send it.
 *
 *   3. Mark complete → send to QC → POST /api/cases/[id]/complete-repair
 *      - Phase A v2: enabled whenever status is IN_REPAIR. The earlier
 *        task-based completion gate is gone (tasks were replaced with
 *        the RepairGuide picker, which doesn't carry a forced
 *        completion checklist).
 *      - Confirmation panel: "Send X to QC? Y parts used."
 *      - The API requires a `diagnosis` body field (min 3 chars). We
 *        pass the case's existing diagnosis (set by inbound during
 *        triage) when present, otherwise fall back to a generic
 *        "Repair completed by mechanic." line. Mechanic notes were
 *        already saved to internalNotes via the workshop's auto-save
 *        endpoint, so we don't send `repairNotes`.
 *
 * After any successful action we navigate to /workshop because the
 * case has either left the mechanic (pause / recharge / complete) or
 * the page's status gate would redirect us anyway.
 *
 * UI pattern: when no form is open, the bar shows a stat line + the
 * three action buttons. When a form opens, the bar's content is
 * replaced by the form (inline edit pattern, matches existing app
 * conventions which favour inline forms over modals).
 */

type OpenForm = null | 'pause' | 'recharge' | 'complete'

type Props = {
  caseId:          string
  status:          string
  orderNumber:     string
  /** Pre-existing diagnosis from inbound triage. Used as the diagnosis
   *  body field to satisfy completeRepairSchema's min(3) requirement. */
  caseDiagnosis:   string | null
  partsCount:      number
}

export default function JobActionBar({
  caseId,
  status,
  orderNumber,
  caseDiagnosis,
  partsCount,
}: Props) {
  const router = useRouter()

  /* Which form is open. Mutually exclusive — clicking another action
   * closes the previous one. */
  const [openForm, setOpenForm] = useState<OpenForm>(null)

  /* Per-form state (kept across opens — if you cancel and reopen,
   * we don't dump what you've typed). */
  const [partsNote,       setPartsNote]       = useState('')
  const [rechargeReason,  setRechargeReason]  = useState('')
  const [rechargeLoc,     setRechargeLoc]     = useState('')

  /* Per-button busy flag — never a single shared `busy` per project
   * conventions. */
  const [pauseBusy,    setPauseBusy]    = useState(false)
  const [rechargeBusy, setRechargeBusy] = useState(false)
  const [completeBusy, setCompleteBusy] = useState(false)

  /* Per-form error. Cleared whenever the form is reopened. */
  const [error, setError] = useState<string | null>(null)

  function open(form: OpenForm) {
    setOpenForm(form)
    setError(null)
  }
  function close() {
    setOpenForm(null)
    setError(null)
  }

  /* ─── Mutations ───────────────────────────────────────────────────── */

  async function pauseForParts() {
    setPauseBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${caseId}/awaiting-parts`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ partsNote: partsNote.trim() || undefined }),
      })
      if (res.ok) {
        router.push('/workshop')
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to pause for parts')
      }
    } finally {
      setPauseBusy(false)
    }
  }

  async function sendToRecharge() {
    const trimmedReason = rechargeReason.trim()
    if (!trimmedReason) {
      setError('Reason is required so CS knows what to re-quote.')
      return
    }
    setRechargeBusy(true)
    setError(null)
    try {
      // Optional: parking the scooter somewhere physically while CS
      // re-quotes. Set rackLocation first; if it fails we still try the
      // escalation rather than blocking the whole flow on a string field.
      const trimmedLoc = rechargeLoc.trim()
      if (trimmedLoc) {
        await fetch(`/api/cases/${caseId}/location`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ rackLocation: trimmedLoc }),
        }).catch(() => {/* swallow — non-fatal */})
      }

      const res = await fetch(`/api/cases/${caseId}/escalate-to-cs`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: trimmedReason }),
      })
      if (res.ok) {
        router.push('/workshop')
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to send to CS')
      }
    } finally {
      setRechargeBusy(false)
    }
  }

  async function markComplete() {
    // Build a diagnosis that satisfies the API's min(3) constraint.
    // Inbound's triage usually fills `caseDiagnosis`; if for some reason
    // it didn't, fall back to a generic line so the API call still passes
    // its validation.
    let diagnosis = caseDiagnosis?.trim() ?? ''
    if (diagnosis.length < 3) {
      diagnosis = 'Repair completed by mechanic.'
    }
    diagnosis = diagnosis.slice(0, 2000)

    setCompleteBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${caseId}/complete-repair`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ diagnosis }),
      })
      if (res.ok) {
        router.push('/workshop')
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to send case to QC')
      }
    } finally {
      setCompleteBusy(false)
    }
  }

  /* ─── Computed ────────────────────────────────────────────────────── */

  const canAct          = status === 'IN_REPAIR'
  // Phase A v2: the strict task-completion gate is gone (tasks were
  // replaced by the guide picker). Mark-complete is enabled whenever
  // the case is IN_REPAIR.
  const canMarkComplete = canAct

  // Tooltip copy for each disabled state.
  const completeTooltip =
    canAct
      ? 'Send this case to QC.'
      : `Mark-complete is only available when the case is in repair (status: ${status}).`

  const pauseTooltip =
    canAct ? 'Pause this job and free it up for parts to arrive.'
           : `Pause is only available when the case is in repair (status: ${status}).`

  const rechargeTooltip =
    canAct ? 'Found extra damage? Send back to CS for a recharge.'
           : `Recharge is only available when the case is in repair (status: ${status}).`

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <div
      style={{
        position:    'fixed',
        left:        0,
        right:       0,
        bottom:      0,
        background:  'var(--surface)',
        borderTop:   '1px solid var(--border)',
        boxShadow:   '0 -4px 12px rgba(0,0,0,0.04)',
        zIndex:      10,
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin:   '0 auto',
          padding:  '12px 16px',
        }}
      >
        {openForm === null && (
          <DefaultRow
            partsCount={partsCount}
            canAct={canAct}
            canMarkComplete={canMarkComplete}
            pauseTooltip={pauseTooltip}
            rechargeTooltip={rechargeTooltip}
            completeTooltip={completeTooltip}
            onOpenPause={() => open('pause')}
            onOpenRecharge={() => open('recharge')}
            onOpenComplete={() => open('complete')}
          />
        )}

        {openForm === 'pause' && (
          <PauseForm
            note={partsNote}
            onNoteChange={setPartsNote}
            error={openForm === 'pause' ? error : null}
            busy={pauseBusy}
            onConfirm={pauseForParts}
            onCancel={close}
          />
        )}

        {openForm === 'recharge' && (
          <RechargeForm
            reason={rechargeReason}
            onReasonChange={setRechargeReason}
            location={rechargeLoc}
            onLocationChange={setRechargeLoc}
            error={openForm === 'recharge' ? error : null}
            busy={rechargeBusy}
            onConfirm={sendToRecharge}
            onCancel={close}
          />
        )}

        {openForm === 'complete' && (
          <CompleteConfirm
            orderNumber={orderNumber}
            partsCount={partsCount}
            error={openForm === 'complete' ? error : null}
            busy={completeBusy}
            onConfirm={markComplete}
            onCancel={close}
          />
        )}
      </div>
    </div>
  )
}

/* ─── Default row ────────────────────────────────────────────────────── */

function DefaultRow({
  partsCount,
  canAct,
  canMarkComplete,
  pauseTooltip,
  rechargeTooltip,
  completeTooltip,
  onOpenPause,
  onOpenRecharge,
  onOpenComplete,
}: {
  partsCount:      number
  canAct:          boolean
  canMarkComplete: boolean
  pauseTooltip:    string
  rechargeTooltip: string
  completeTooltip: string
  onOpenPause:     () => void
  onOpenRecharge:  () => void
  onOpenComplete:  () => void
}) {
  return (
    <div
      style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            10,
        flexWrap:       'wrap',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--sub)' }}>
        {partsCount} part{partsCount === 1 ? '' : 's'} used
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn
          variant="warning"
          size="md"
          disabled={!canAct}
          title={pauseTooltip}
          onClick={onOpenPause}
        >
          Pause for parts
        </Btn>
        <Btn
          variant="danger"
          size="md"
          disabled={!canAct}
          title={rechargeTooltip}
          onClick={onOpenRecharge}
        >
          Send to CS for recharge
        </Btn>
        <Btn
          variant="success"
          size="lg"
          disabled={!canMarkComplete}
          title={completeTooltip}
          onClick={onOpenComplete}
        >
          Mark complete → send to QC
        </Btn>
      </div>
    </div>
  )
}

/* ─── Pause for parts form ──────────────────────────────────────────── */

function PauseForm({
  note,
  onNoteChange,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  note:          string
  onNoteChange:  (v: string) => void
  error:         string | null
  busy:          boolean
  onConfirm:     () => void
  onCancel:      () => void
}) {
  return (
    <FormShell tone="amber" title="Pause for parts">
      <label
        className="eyebrow"
        htmlFor="pause-parts-note"
        style={{ color: 'var(--amber-text)', marginBottom: 4 }}
      >
        What part(s) are you waiting on? (optional)
      </label>
      <input
        id="pause-parts-note"
        type="text"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onConfirm()
          }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="e.g. Front brake caliper — eta Tuesday"
        disabled={busy}
        autoFocus
        style={{ fontSize: 13 }}
      />
      <FormFooter
        helper="The case will leave your queue and become claimable again once parts arrive."
        error={error}
        confirmLabel="Confirm pause"
        confirmVariant="warning"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </FormShell>
  )
}

/* ─── Recharge form ──────────────────────────────────────────────────── */

function RechargeForm({
  reason,
  onReasonChange,
  location,
  onLocationChange,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  reason:           string
  onReasonChange:   (v: string) => void
  location:         string
  onLocationChange: (v: string) => void
  error:            string | null
  busy:             boolean
  onConfirm:        () => void
  onCancel:         () => void
}) {
  return (
    <FormShell tone="red" title="Send to CS for recharge">
      <label
        className="eyebrow"
        htmlFor="recharge-reason"
        style={{ color: 'var(--red-text)', marginBottom: 4 }}
      >
        What did you find? CS will quote the customer.
      </label>
      <textarea
        id="recharge-reason"
        rows={2}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="e.g. Battery casing cracked from impact — needs full replacement (£180)."
        disabled={busy}
        autoFocus
        style={{ fontSize: 13, resize: 'vertical', minHeight: 50 }}
      />

      <label
        className="eyebrow"
        htmlFor="recharge-location"
        style={{ color: 'var(--red-text)', marginTop: 4, marginBottom: 4 }}
      >
        Where are you parking the scooter? (optional)
      </label>
      <input
        id="recharge-location"
        type="text"
        value={location}
        onChange={(e) => onLocationChange(e.target.value)}
        placeholder="e.g. MECH-HOLD-3"
        disabled={busy}
        style={{ fontSize: 13 }}
      />

      <FormFooter
        helper="The case will move out of your queue while CS re-quotes the customer. The location helps your team find it."
        error={error}
        confirmLabel="Send to CS"
        confirmVariant="danger"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </FormShell>
  )
}

/* ─── Complete confirmation panel ───────────────────────────────────── */

function CompleteConfirm({
  orderNumber,
  partsCount,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  orderNumber:    string
  partsCount:     number
  error:          string | null
  busy:           boolean
  onConfirm:      () => void
  onCancel:       () => void
}) {
  return (
    <FormShell tone="green" title="Send to QC?">
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
        Send <strong className="mono">{orderNumber}</strong> to QC?{' '}
        {partsCount} part{partsCount === 1 ? '' : 's'} used on this case.
      </div>
      <FormFooter
        helper="QC will inspect and either pass it (→ ready to ship) or fail it back to you."
        error={error}
        confirmLabel="Confirm — send to QC"
        confirmVariant="success"
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </FormShell>
  )
}

/* ─── Shared shell + footer ──────────────────────────────────────────── */

function FormShell({
  tone,
  title,
  children,
}: {
  tone:     'amber' | 'red' | 'green'
  title:    string
  children: React.ReactNode
}) {
  const bg =
    tone === 'amber' ? 'var(--amber-bg)'
    : tone === 'red'   ? 'var(--red-bg)'
                       : 'var(--green-bg)'
  const text =
    tone === 'amber' ? 'var(--amber-text)'
    : tone === 'red'   ? 'var(--red-text)'
                       : 'var(--green-text)'

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        padding:       12,
        borderRadius:  'var(--radius-md)',
        background:    bg,
        border:        '1px solid transparent',
      }}
    >
      <div className="eyebrow" style={{ color: text }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function FormFooter({
  helper,
  error,
  confirmLabel,
  confirmVariant,
  busy,
  onConfirm,
  onCancel,
}: {
  helper:         string
  error:          string | null
  confirmLabel:   string
  confirmVariant: 'warning' | 'danger' | 'success'
  busy:           boolean
  onConfirm:      () => void
  onCancel:       () => void
}) {
  return (
    <>
      {error && (
        <div
          style={{
            fontSize:    12,
            color:       'var(--red-text)',
            background:  'var(--red-bg)',
            padding:     '6px 10px',
            borderRadius:6,
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent:'space-between',
          gap:           8,
          flexWrap:      'wrap',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--sub)', maxWidth: 480 }}>
          {helper}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </>
  )
}
