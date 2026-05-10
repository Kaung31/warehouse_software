'use client'

import { useRef, useState } from 'react'

/**
 * JobNotes — single textarea for the mechanic's free-text notes.
 *
 * Auto-saves on blur via PATCH /api/cases/[id]/mechanic-notes (which
 * writes to RepairOrder.internalNotes — no schema change).
 *
 * We track a `lastSaved` baseline and only fire the request when the
 * value has actually changed. This keeps blur-on-focus-change cheap.
 */

type Props = {
  caseId:       string
  initialNotes: string
}

export default function JobNotes({ caseId, initialNotes }: Props) {
  const [value,    setValue]    = useState(initialNotes)
  const [saving,   setSaving]   = useState(false)
  const [savedAt,  setSavedAt]  = useState<number | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const lastSaved              = useRef(initialNotes)

  async function save() {
    if (value === lastSaved.current) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/cases/${caseId}/mechanic-notes`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ notes: value.length > 0 ? value : null }),
      })
      if (res.ok) {
        lastSaved.current = value
        setSavedAt(Date.now())
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to save notes')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        background:    'var(--surface)',
        border:        '1px solid var(--border)',
        borderRadius:  'var(--radius-lg)',
        padding:       '16px 18px',
        boxShadow:     'var(--card-sh)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="eyebrow" style={{ color: 'var(--text)', opacity: 0.7 }}>
          Mechanic notes
        </div>
        <div style={{ fontSize: 11, color: 'var(--sub)', minHeight: 16 }}>
          {error
            ? <span style={{ color: 'var(--red-text)' }}>{error}</span>
            : saving
              ? 'Saving…'
              : savedAt
                ? 'Saved'
                : ''}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        placeholder="Diagnosis details, what you found, what you did. Saves automatically when you tab away."
        rows={5}
        style={{
          width:      '100%',
          fontSize:   13,
          lineHeight: 1.55,
          resize:     'vertical',
          minHeight:  100,
        }}
      />
    </div>
  )
}
