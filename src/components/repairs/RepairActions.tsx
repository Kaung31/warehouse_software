'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'
import { STATUS_TRANSITIONS } from '@/lib/schemas/repair'
import { RepairStatus } from '@prisma/client'

type Props = {
  repair:    { id: string; status: RepairStatus; mechanicId: string | null }
  mechanics: { id: string; name: string }[]
  userRole:  string
  userId:    string
}

export default function RepairActions({ repair, mechanics, userRole, userId }: Props) {
  const router  = useRouter()
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  const nextStatuses = STATUS_TRANSITIONS[repair.status] ?? []
  const canChangeStatus = userRole !== 'CS' && userRole !== 'WAREHOUSE'
  const canAssign       = ['ADMIN', 'MANAGER'].includes(userRole)
  const canShip         = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)

  async function changeStatus(status: RepairStatus) {
    setBusy(true); setError('')
    const res = await fetch(`/api/repairs/${repair.id}/status`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setError('Failed to update status')
  }

  async function assignMechanic(mechanicId: string) {
    setBusy(true); setError('')
    const res = await fetch(`/api/repairs/${repair.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mechanicId }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setError('Failed to assign mechanic')
  }

  async function generateLabel() {
    setBusy(true); setError('')
    const res = await fetch(`/api/repairs/${repair.id}/ship`, { method: 'POST' })
    setBusy(false)
    if (res.ok) {
      const { data } = await res.json()
      // Open label PDF in new tab
      const blob = new Blob(
        [Uint8Array.from(atob(data.labelPdf), c => c.charCodeAt(0))],
        { type: 'application/pdf' }
      )
      window.open(URL.createObjectURL(blob), '_blank')
      router.refresh()
    } else {
      setError('Failed to generate DPD label')
    }
  }

  return (
    <div style={{
      background:    'var(--bg-surface)',
      border:        '1px solid var(--border)',
      borderRadius:  'var(--radius)',
      padding:       '16px',
      display:       'flex',
      flexDirection: 'column',
      gap:           12,
      alignSelf:     'flex-start',
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Actions
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)', background: '#1a0f0f', padding: '8px 10px', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Status transitions */}
      {canChangeStatus && nextStatuses.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>Change status</div>
          {nextStatuses.map((s) => (
            <Btn key={s} variant="ghost" size="sm" disabled={busy} onClick={() => changeStatus(s as RepairStatus)} style={{ justifyContent: 'flex-start' }}>
              → {s.replace(/_/g, ' ')}
            </Btn>
          ))}
        </div>
      )}

      {/* Assign mechanic */}
      {canAssign && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>Assign mechanic</div>
          <select
            defaultValue={repair.mechanicId ?? ''}
            onChange={e => assignMechanic(e.target.value)}
            disabled={busy}
            style={{
              width: '100%', background: 'var(--bg-raised)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              color: 'var(--text)', padding: '7px 10px', fontSize: 12,
              fontFamily: 'var(--font-sans)',
            }}
          >
            <option value="">— Unassigned</option>
            {mechanics.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* DPD label */}
      {canShip && repair.status === 'READY_TO_SHIP' && (
        <Btn variant="primary" disabled={busy} onClick={generateLabel}>
          {busy ? 'Generating...' : '⎙ Generate DPD label'}
        </Btn>
      )}
    </div>
  )
}