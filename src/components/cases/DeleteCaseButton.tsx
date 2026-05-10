'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

type Props = {
  caseId:      string
  orderNumber: string
  status:      string
}

export default function DeleteCaseButton({ caseId, orderNumber, status }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy,       setBusy]       = useState(false)
  const [error,      setError]      = useState('')

  const isEarlyStage = ['AWAITING_INBOUND', 'BGRADE_RECORDED'].includes(status)
  const label        = isEarlyStage ? 'Delete case' : 'Cancel case'
  const description  = isEarlyStage
    ? 'This will permanently delete the case. This cannot be undone.'
    : 'This will mark the case as CANCELLED. The history will be preserved.'

  async function confirm() {
    setBusy(true); setError('')
    const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      router.push('/cases')
    } else {
      const b = await res.json()
      setError(b.error ?? 'Failed to delete case')
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div>
        <Btn variant="danger" size="sm" onClick={() => setConfirming(true)}>
          🗑 {label}
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
        {label} — {orderNumber}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{description}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="danger" size="sm" disabled={busy} onClick={confirm}>
          {busy ? 'Processing…' : `Yes, ${label.toLowerCase()}`}
        </Btn>
        <Btn variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Keep case
        </Btn>
      </div>
    </div>
  )
}
