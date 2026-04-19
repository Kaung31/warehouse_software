'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

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

type Props = { caseId: string }

export default function InboundPanel({ caseId }: Props) {
  const router = useRouter()
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [diagnosis,     setDiagnosis]     = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  function toggleCode(code: string) {
    setSelectedCodes(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (selectedCodes.length === 0) { setError('Select at least one error code'); return }
    if (!diagnosis.trim()) { setError('Technical diagnosis is required'); return }
    setBusy(true); setError('')

    const res = await fetch(`/api/cases/${caseId}/inbound-triage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        errorCodes:   selectedCodes,
        diagnosis:    diagnosis.trim(),
        internalNotes: internalNotes.trim() || undefined,
      }),
    })
    setBusy(false)
    if (res.ok) {
      router.refresh()
    } else {
      const b = await res.json()
      setError(b.error ?? 'Failed to submit triage')
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      <div style={{
        padding:      '12px 14px',
        background:   'var(--amber-bg, #fef3c7)',
        border:       '1px solid var(--amber, #f59e0b)',
        borderRadius: 'var(--radius)',
        fontSize:     13,
        color:        'var(--amber-text, #92400e)',
      }}>
        Scooter has arrived at the depot. Complete inbound triage to unlock the payment gate.
      </div>

      <SectionTitle>Error codes <Req /></SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ERROR_CODES.map(ec => {
          const sel = selectedCodes.includes(ec.value)
          return (
            <button
              key={ec.value}
              type="button"
              onClick={() => toggleCode(ec.value)}
              style={{
                padding:      '5px 12px',
                fontSize:     12,
                border:       `1px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 20,
                background:   sel ? 'var(--accent-dim)' : 'transparent',
                color:        sel ? '#fff' : 'var(--text-muted)',
                cursor:       'pointer',
                transition:   'all 0.1s',
              }}
            >
              {ec.label}
            </button>
          )
        })}
      </div>

      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          Technical diagnosis <Req />
        </label>
        <textarea
          rows={4}
          value={diagnosis}
          onChange={e => setDiagnosis(e.target.value)}
          placeholder="Describe what the inbound team found upon physical inspection…"
          required
          style={{ resize: 'vertical' }}
        />
      </div>

      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          Internal notes
        </label>
        <input
          value={internalNotes}
          onChange={e => setInternalNotes(e.target.value)}
          placeholder="Any notes for CS or the mechanic…"
        />
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red)',
          borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <Btn variant="primary" type="submit" disabled={busy}>
        {busy ? 'Submitting…' : '✓ Confirm arrival — notify CS'}
      </Btn>
    </form>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
      {children}
    </div>
  )
}
function Req() {
  return <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>
}
