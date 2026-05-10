'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'

export default function NewPalletPage() {
  const router = useRouter()
  const [purpose,  setPurpose]  = useState<'BGRADE' | 'HOLDING'>('BGRADE')
  const [capacity, setCapacity] = useState(10)
  const [location, setLocation] = useState('')
  const [notes,    setNotes]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const res = await fetch('/api/pallets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ purpose, capacity, locationCode: location.trim().toUpperCase() || undefined, notes: notes.trim() || undefined }),
    })
    setBusy(false)
    if (res.ok) {
      const { data } = await res.json()
      router.push(`/pallets/${data.id}`)
    } else {
      const b = await res.json()
      setError(b.error ?? 'Failed to create pallet')
    }
  }

  return (
    <div className="fade-up" style={{ maxWidth: 540 }}>
      <PageHeader
        title="New pallet"
        sub="Create a pallet to group scooters for storage or holding"
        action={<Link href="/pallets"><Btn variant="ghost" size="sm">← Back</Btn></Link>}
      />

      <form onSubmit={submit}>
        <div className="card" style={{ padding: '24px' }}>

          {/* Purpose */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 10, fontWeight: 600 }}>Pallet type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { key: 'BGRADE',  label: '♻ B-Grade',  desc: 'Pre-owned scooters for grading & storage' },
                { key: 'HOLDING', label: '⏳ Holding',  desc: 'Warranty cases on hold (awaiting parts / delayed)' },
              ].map(opt => (
                <button key={opt.key} type="button"
                  onClick={() => setPurpose(opt.key as 'BGRADE' | 'HOLDING')}
                  style={{
                    padding: '14px', cursor: 'pointer', textAlign: 'left',
                    border:      `2px solid ${purpose === opt.key ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-lg)',
                    background:   purpose === opt.key ? 'var(--accent-dim)' : 'var(--bg-raised)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13, color: purpose === opt.key ? 'var(--accent)' : 'var(--text)', marginBottom: 3 }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Capacity */}
          <div style={{ marginBottom: 16 }}>
            <label>Capacity (max scooters)</label>
            <input
              type="number" min={1} max={50} value={capacity}
              onChange={e => setCapacity(Number(e.target.value))}
            />
          </div>

          {/* Location */}
          <div style={{ marginBottom: 16 }}>
            <label>Starting location <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>(optional)</span></label>
            <input
              value={location}
              onChange={e => setLocation(e.target.value.toUpperCase())}
              placeholder="e.g. INBOUND-R1-L1"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
              Format: ZONE-R[rack]-L[level] e.g. INBOUND-R2-L3, QC-R1-L1
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label>Notes <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>(optional)</span></label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. March B-grade batch, mixed Pure models…" style={{ resize: 'vertical' }} />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Link href="/pallets"><Btn variant="secondary">Cancel</Btn></Link>
            <Btn variant="primary" type="submit" disabled={busy}>
              {busy ? 'Creating…' : '+ Create pallet'}
            </Btn>
          </div>
        </div>
      </form>
    </div>
  )
}
