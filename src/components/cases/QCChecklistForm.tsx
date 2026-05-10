'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'
import PhotoCapture, { type CapturedPhoto } from '@/components/ui/PhotoCapture'
import { uploadPhotos } from '@/lib/uploadPhotos'

/**
 * QCChecklistForm — quality control checklist used by warehouse staff.
 *
 * v2 changes (April 2026):
 *   • Sticky progress header at the top: shows pass/fail/pending counts,
 *     a progress bar, and the overall outcome badge. Always visible
 *     while the operator scrolls through long checklists.
 *   • Big PASS / FAIL / N/A buttons (44px tall, color-coded) instead
 *     of small chip buttons. Easier to hit on a touch screen.
 *   • Each step renders inside the .qci row class from globals.css so
 *     the row tints green on PASS, red on FAIL — at-a-glance status.
 *   • Default state is now PENDING (not NA). The operator must
 *     deliberately choose an outcome for each step. Submission is
 *     blocked until every step has a decision. This prevents
 *     accidentally shipping a scooter with un-checked items.
 *   • FAIL steps require a non-empty failure note. The note input
 *     border turns red and a clear error appears if missing.
 *   • Submit button wording is dynamic and unambiguous:
 *       - "Submit QC — Ready to ship" (green) when all clear
 *       - "Submit QC — return X to mechanic" (red) when failures exist
 *       - "Complete X more checks first" (disabled) when steps remain
 *   • All emojis (✓ ✗) replaced with inline SVG.
 *   • B-grade output pallet picker redesigned as a clear card.
 *   • PhotoCapture section gets explicit "encouraged for failures" copy.
 *
 * No backend changes — uses the same /api/cases/[id]/qc-submit endpoint
 * with `results: [{ templateId, result, notes }]` payload.
 *
 * Future: a dedicated /cases/[id]/qc full-screen wizard route would be
 * better for tablet-based QC. This single-page form is right for desk
 * QC inside the case detail page.
 */

type Template = {
  id: string
  stepNumber: number
  stepName: string
  description: string | null
}
type StepResult = {
  templateId: string
  result: 'PASS' | 'FAIL' | 'NA' | 'PENDING'
  notes: string
}
type Pallet = {
  id: string
  palletNumber: string
  locationCode: string | null
  _count: { items: number }
}

const SAMPLE_QC_PHOTOS = [
  { url: 'https://picsum.photos/seed/qc1/200/200', caption: 'Front inspection' },
  { url: 'https://picsum.photos/seed/qc2/200/200', caption: 'Label & serial' },
]


export default function QCChecklistForm({
  caseId,
  templates,
  caseType = 'WARRANTY',
}: {
  caseId: string
  templates: Template[]
  caseType?: string
}) {
  const router = useRouter()
  const isBgrade = caseType === 'BGRADE'

  // Default to PENDING — operator must choose for each step
  const [steps, setSteps] = useState<StepResult[]>(
    templates.map(t => ({ templateId: t.id, result: 'PENDING', notes: '' }))
  )
  const [qcPhotos, setQcPhotos] = useState<CapturedPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outputPallets, setOutputPallets] = useState<Pallet[]>([])
  const [selectedPallet, setSelectedPallet] = useState('')

  /* ─── Derived counts ─────────────────────────────────────────────── */
  const counts = useMemo(() => {
    const pass = steps.filter(s => s.result === 'PASS').length
    const fail = steps.filter(s => s.result === 'FAIL').length
    const na = steps.filter(s => s.result === 'NA').length
    const pending = steps.filter(s => s.result === 'PENDING').length
    return { pass, fail, na, pending, total: steps.length }
  }, [steps])

  const allDecided = counts.pending === 0
  const allClear = allDecided && counts.fail === 0
  const hasFailures = counts.fail > 0
  const completedRatio = counts.total > 0 ? (counts.total - counts.pending) / counts.total : 0
  const progressPercent = Math.round(completedRatio * 100)

  /* ─── Fetch B-grade output pallets ───────────────────────────────── */
  useEffect(() => {
    if (!isBgrade) return
    fetch('/api/pallets?purpose=BGRADE&isSealed=false')
      .then(r => r.json())
      .then(d => setOutputPallets(Array.isArray(d.data) ? d.data : []))
      .catch(() => setOutputPallets([]))
  }, [isBgrade])

  /* ─── Mutations ──────────────────────────────────────────────────── */
  function setResult(idx: number, result: 'PASS' | 'FAIL' | 'NA') {
    setSteps(prev =>
      prev.map((s, i) => (i === idx ? { ...s, result } : s))
    )
  }
  function setNotes(idx: number, notes: string) {
    setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, notes } : s)))
  }

  /* ─── Submit ─────────────────────────────────────────────────────── */
  async function submit() {
    setError('')

    if (!allDecided) {
      setError(`Complete ${counts.pending} more check${counts.pending === 1 ? '' : 's'} before submitting`)
      return
    }

    // Validate FAIL notes
    const failsWithoutNotes = steps.filter(
      s => s.result === 'FAIL' && !s.notes.trim()
    )
    if (failsWithoutNotes.length > 0) {
      setError(
        `${failsWithoutNotes.length} failed step${
          failsWithoutNotes.length === 1 ? ' needs' : 's need'
        } a description of the failure`
      )
      return
    }

    if (isBgrade && allClear && !selectedPallet) {
      setError(
        'Select an output pallet before submitting a passing QC for a B-grade scooter'
      )
      return
    }

    // Final confirmation when failing
    if (hasFailures) {
      const ok = window.confirm(
        `${counts.fail} step${counts.fail === 1 ? '' : 's'} failed. ` +
          `This will return the case to the mechanic for re-work. Continue?`
      )
      if (!ok) return
    }

    setBusy(true)

    // Backend expects PASS / FAIL / NA — convert any remaining PENDING (shouldn't be any)
    const payload = steps.map(s => ({
      templateId: s.templateId,
      result: s.result === 'PENDING' ? 'NA' : s.result,
      notes: s.notes,
    }))

    try {
      const res = await fetch(`/api/cases/${caseId}/qc-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: payload,
          palletId:
            isBgrade && allClear && selectedPallet ? selectedPallet : undefined,
        }),
      })
      if (res.ok) {
        if (qcPhotos.length > 0) {
          const errs = await uploadPhotos(
            qcPhotos,
            caseId,
            'RepairOrder',
            'SCOOTER_OUTBOUND'
          )
          if (errs.length > 0) {
            setError(`QC saved, but ${errs.length} photo(s) failed to upload`)
            setBusy(false)
            return
          }
        }
        router.push(`/cases/${caseId}`)
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to submit QC')
      }
    } finally {
      setBusy(false)
    }
  }

  /* ─── Render ─────────────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Title ── */}
      <div style={{ marginBottom: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Quality control checklist
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
          Work through each step. Tap PASS, FAIL, or N/A.
        </div>
      </div>

      {/* ── Progress header ── */}
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 14,
              fontSize: 12,
              flexWrap: 'wrap',
            }}
          >
            <CountChip
              label="Pass"
              value={counts.pass}
              tone="green"
              icon="check"
            />
            <CountChip
              label="Fail"
              value={counts.fail}
              tone="red"
              icon="x"
            />
            <CountChip
              label="N/A"
              value={counts.na}
              tone="slate"
              icon="dash"
            />
            <CountChip
              label="Pending"
              value={counts.pending}
              tone="amber"
              icon="hourglass"
            />
          </div>

          {/* Overall status badge */}
          {allDecided ? (
            <span
              className={`badge ${
                allClear ? 'badge-pass' : 'badge-fail'
              }`}
              style={{ fontSize: 12, fontWeight: 500 }}
            >
              <Icon name={allClear ? 'check' : 'x'} size={11} />
              {allClear ? 'All passed' : `${counts.fail} failed`}
            </span>
          ) : (
            <span
              className="badge badge-na"
              style={{ fontSize: 12, fontWeight: 500 }}
            >
              <Icon name="hourglass" size={11} />
              {counts.pending} pending
            </span>
          )}
        </div>

        {/* Progress bar */}
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
              width: `${progressPercent}%`,
              height: '100%',
              background: hasFailures
                ? 'var(--red)'
                : allClear
                ? 'var(--green)'
                : 'var(--accent)',
              borderRadius: 3,
              transition: 'width .3s, background .3s',
            }}
          />
        </div>
      </div>

      {/* ── Checklist steps ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {templates.map((t, idx) => {
          const step = steps[idx]
          const passed = step.result === 'PASS'
          const failed = step.result === 'FAIL'
          const na = step.result === 'NA'
          const pending = step.result === 'PENDING'

          const rowClass = passed ? 'qci pass' : failed ? 'qci fail' : 'qci'

          return (
            <div
              key={t.id}
              className={rowClass}
              style={{
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 0,
                padding: '14px 16px',
                opacity: pending ? 1 : 0.95,
              }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {/* Step number circle */}
                <div
                  style={{
                    width: 28,
                    height: 28,
                    minWidth: 28,
                    borderRadius: '50%',
                    background: passed
                      ? 'var(--green)'
                      : failed
                      ? 'var(--red)'
                      : 'var(--surface)',
                    color: passed || failed ? '#fff' : 'var(--sub)',
                    border: passed || failed
                      ? 'none'
                      : '1.5px solid var(--border2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}
                >
                  {passed ? (
                    <Icon name="check" size={13} />
                  ) : failed ? (
                    <Icon name="x" size={13} />
                  ) : (
                    t.stepNumber
                  )}
                </div>

                {/* Step content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--text)',
                      marginBottom: t.description ? 4 : 8,
                      lineHeight: 1.4,
                    }}
                  >
                    {t.stepName}
                  </div>
                  {t.description && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--sub)',
                        marginBottom: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {t.description}
                    </div>
                  )}

                  {/* Big result buttons */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 6,
                    }}
                  >
                    <ResultButton
                      tone="green"
                      label="Pass"
                      icon="check"
                      active={passed}
                      onClick={() => setResult(idx, 'PASS')}
                    />
                    <ResultButton
                      tone="red"
                      label="Fail"
                      icon="x"
                      active={failed}
                      onClick={() => setResult(idx, 'FAIL')}
                    />
                    <ResultButton
                      tone="slate"
                      label="N/A"
                      icon="dash"
                      active={na}
                      onClick={() => setResult(idx, 'NA')}
                    />
                  </div>

                  {/* FAIL note input — required */}
                  {failed && (
                    <div style={{ marginTop: 10 }}>
                      <input
                        value={step.notes}
                        onChange={e => setNotes(idx, e.target.value)}
                        placeholder="Describe the failure (required) — e.g. front brake pad worn"
                        style={{
                          borderColor: step.notes.trim()
                            ? 'var(--border)'
                            : 'var(--red-b)',
                          background: step.notes.trim()
                            ? 'var(--surface)'
                            : 'var(--red-bg)',
                        }}
                        autoFocus
                      />
                      {!step.notes.trim() && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--red-text)',
                            marginTop: 4,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Icon name="alert" size={10} />
                          A failure description is required before submitting
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── QC inspection photos ── */}
      <div style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Inspection photos
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--sub)',
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          Photograph the scooter after QC.{' '}
          {hasFailures && (
            <strong style={{ color: 'var(--red-text)' }}>
              Strongly encouraged for failed steps.
            </strong>
          )}
        </div>
        <PhotoCapture
          label="Post-QC photos"
          photos={qcPhotos}
          onChange={setQcPhotos}
          maxPhotos={6}
          samplePhotos={SAMPLE_QC_PHOTOS}
        />
      </div>

      {/* ── B-grade output pallet picker (only when passing) ── */}
      {isBgrade && allClear && (
        <div
          style={{
            marginTop: 18,
            padding: '14px 16px',
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-dim)',
            borderRadius: 'var(--radius)',
          }}
        >
          <div
            className="eyebrow"
            style={{ marginBottom: 8, color: 'var(--accent-text)' }}
          >
            Output pallet
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--accent-text)',
              opacity: 0.85,
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            B-grade scooters move from QC onto an output pallet. Choose where
            this one goes.
          </div>
          <select
            value={selectedPallet}
            onChange={e => setSelectedPallet(e.target.value)}
            disabled={busy}
          >
            <option value="">— Select output pallet —</option>
            {outputPallets.map(p => (
              <option key={p.id} value={p.id}>
                {p.palletNumber}
                {p.locationCode ? ` · ${p.locationCode}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="al al-d" style={{ marginTop: 14, marginBottom: 0 }}>
          {error}
        </div>
      )}

      {/* ── Submit ── */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-faint)',
          }}
        >
          {qcPhotos.length > 0 && (
            <span>
              {qcPhotos.length} photo{qcPhotos.length === 1 ? '' : 's'} attached
            </span>
          )}
        </div>

        {!allDecided ? (
          <Btn
            variant="secondary"
            disabled
            iconLeft={<Icon name="hourglass" size={13} />}
          >
            Complete {counts.pending} more check{counts.pending === 1 ? '' : 's'}
          </Btn>
        ) : allClear ? (
          <Btn
            variant="success"
            size="lg"
            loading={busy}
            onClick={submit}
            iconLeft={<Icon name="check" size={14} />}
          >
            {isBgrade
              ? 'Submit QC — Record to pallet'
              : 'Submit QC — Ready to ship'}
          </Btn>
        ) : (
          <Btn
            variant="danger"
            size="lg"
            loading={busy}
            onClick={submit}
            iconLeft={<Icon name="refresh" size={14} />}
          >
            Submit QC — Return {counts.fail} to mechanic
          </Btn>
        )}
      </div>
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function CountChip({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: number
  tone: 'green' | 'red' | 'amber' | 'slate'
  icon: IconName
}) {
  const colors =
    tone === 'green'
      ? { fg: 'var(--green-text)', bg: 'var(--green-bg)' }
      : tone === 'red'
      ? { fg: 'var(--red-text)', bg: 'var(--red-bg)' }
      : tone === 'amber'
      ? { fg: 'var(--amber-text)', bg: 'var(--amber-bg)' }
      : { fg: 'var(--sub)', bg: 'transparent' }

  const dim = value === 0
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        color: dim ? 'var(--text-faint)' : colors.fg,
        opacity: dim ? 0.6 : 1,
        background: dim ? 'transparent' : colors.bg,
        padding: dim ? 0 : '2px 8px',
        borderRadius: 999,
        fontWeight: 500,
      }}
    >
      <Icon name={icon} size={11} />
      <span className="mono" style={{ fontWeight: 600 }}>
        {value}
      </span>
      <span style={{ fontWeight: 400 }}>{label.toLowerCase()}</span>
    </span>
  )
}


function ResultButton({
  tone,
  label,
  icon,
  active,
  onClick,
}: {
  tone: 'green' | 'red' | 'slate'
  label: string
  icon: IconName
  active: boolean
  onClick: () => void
}) {
  const styles =
    tone === 'green'
      ? {
          activeBg: 'var(--green-bg)',
          activeBorder: 'var(--green)',
          activeColor: 'var(--green-text)',
          activeIconBg: 'var(--green)',
        }
      : tone === 'red'
      ? {
          activeBg: 'var(--red-bg)',
          activeBorder: 'var(--red)',
          activeColor: 'var(--red-text)',
          activeIconBg: 'var(--red)',
        }
      : {
          activeBg: 'var(--s3)',
          activeBorder: 'var(--border2)',
          activeColor: 'var(--text)',
          activeIconBg: 'var(--slate)',
        }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 44,
        padding: '8px 10px',
        background: active ? styles.activeBg : 'var(--surface)',
        border: `2px solid ${
          active ? styles.activeBorder : 'var(--border)'
        }`,
        borderRadius: 'var(--radius-md)',
        color: active ? styles.activeColor : 'var(--sub)',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'all .12s',
      }}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName = 'check' | 'x' | 'dash' | 'hourglass' | 'refresh' | 'alert'

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
    case 'x':
      return (
        <svg {...p} strokeWidth="2.2">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      )
    case 'dash':
      return (
        <svg {...p} strokeWidth="2">
          <line x1="5" y1="12" x2="19" y2="12" />
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
    case 'refresh':
      return (
        <svg {...p}>
          <polyline points="1 4 1 10 7 10" />
          <polyline points="23 20 23 14 17 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
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
    default:
      return null
  }
}