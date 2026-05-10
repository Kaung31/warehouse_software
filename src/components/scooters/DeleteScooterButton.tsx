'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

export default function DeleteScooterButton({ scooterId, serialNumber }: { scooterId: string; serialNumber: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy,       setBusy]       = useState(false)
  const [error,      setError]      = useState('')

  async function confirm() {
    setBusy(true); setError('')
    const res = await fetch(`/api/scooters/${scooterId}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      router.push('/scooters')
    } else {
      const b = await res.json()
      setError(b.error ?? 'Failed to delete scooter')
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div>
        <Btn variant="danger" size="sm" onClick={() => setConfirming(true)}>
          🗑 Delete scooter
        </Btn>
        {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
      </div>
    )
  }

  return (
    <div style={{
      padding:      '14px 16px',
      background:   'var(--red-bg)',
      border:       '1px solid var(--red)',
      borderRadius: 'var(--radius)',
      display:      'flex',
      flexDirection:'column',
      gap:          10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
        Delete scooter — {serialNumber}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Only scooters with no active repair orders can be deleted. This cannot be undone.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="danger" size="sm" disabled={busy} onClick={confirm}>
          {busy ? 'Deleting…' : 'Yes, delete scooter'}
        </Btn>
        <Btn variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Keep scooter
        </Btn>
      </div>
    </div>
  )
}
