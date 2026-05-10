'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'

type Pallet = { id: string; palletNumber: string; locationCode: string | null; _count: { items: number }; capacity: number }
type Location = { id: string; name: string; code: string }

const SOURCES = ['Currys', 'Argos', 'John Lewis', 'Amazon', 'eBay', 'Trade-in', 'Donation', 'Other']

export default function NewBgradePage() {
  const router    = useRouter()
  const serialRef = useRef<HTMLInputElement>(null)

  const [serial,   setSerial]   = useState('')
  const [brand,    setBrand]    = useState('')
  const [model,    setModel]    = useState('')
  const [source,   setSource]   = useState('')
  const [notes,    setNotes]    = useState('')
  const [palletId, setPalletId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [pallets,  setPallets]  = useState<Pallet[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [lookingUp, setLookingUp] = useState(false)

  useEffect(() => { serialRef.current?.focus() }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/pallets?purpose=BGRADE&isSealed=false&pageSize=100').then(r => r.json()),
      fetch('/api/locations').then(r => r.json()),
    ]).then(([pd, ld]) => {
      setPallets(Array.isArray(pd.data?.pallets) ? pd.data.pallets : Array.isArray(pd.data) ? pd.data : [])
      setLocations(Array.isArray(ld.data) ? ld.data : [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (serial.length < 4) { setBrand(''); setModel(''); return }
    const t = setTimeout(async () => {
      setLookingUp(true)
      try {
        const res   = await fetch(`/api/scooters?search=${encodeURIComponent(serial)}&pageSize=1`)
        const d     = await res.json()
        const found = d.data?.scooters?.[0]
        if (found && found.serialNumber.toLowerCase() === serial.toLowerCase()) {
          setBrand(b => b || found.brand || '')
          setModel(m => m || found.model || '')
        }
      } finally { setLookingUp(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [serial])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!serial.trim() || !brand.trim() || !model.trim()) {
      setError('Serial, brand, and model are required'); return
    }
    setBusy(true); setError('')

    // Step 1: create case (BGRADE, no customer required)
    const intakeRes = await fetch('/api/cases/intake', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serialNumber:    serial.trim().toUpperCase(),
        brand:           brand.trim(),
        model:           model.trim(),
        caseType:        'BGRADE',
        faultDescription: notes.trim() || 'B-grade intake',
        source:          source.trim() || undefined,
        internalNotes:   notes.trim() || undefined,
      }),
    })

    if (!intakeRes.ok) {
      setBusy(false)
      const b = await intakeRes.json()
      setError(b.error ?? 'Failed to create case'); return
    }

    const { data } = await intakeRes.json()
    const caseId   = data.id

    // Step 2: inbound triage (no error codes for BGRADE, assigns pallet)
    const triageRes = await fetch(`/api/cases/${caseId}/inbound-triage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internalNotes: notes.trim() || undefined,
        palletId:      palletId || undefined,
      }),
    })

    // Step 3: set location if chosen
    if (locationId && triageRes.ok) {
      await fetch(`/api/cases/${caseId}/location`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ locationId }),
      })
    }

    setBusy(false)
    if (triageRes.ok) {
      router.push(`/cases/${caseId}`)
    } else {
      const b = await triageRes.json()
      setError(b.error ?? 'Case created but inbound triage failed')
    }
  }

  return (
    <div className="fade-up" style={{ maxWidth: 560 }}>
      <PageHeader
        title="New B-Grade entry"
        sub="Inbound scan — serial, source, pallet"
        action={<Link href="/b-grade"><Btn variant="ghost" size="sm">← Back</Btn></Link>}
      />

      <form onSubmit={submit}>
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Serial */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8, display: 'block' }}>
              Serial number <span style={{ color: 'var(--red)' }}>*</span>
            </label>
            <input
              ref={serialRef}
              value={serial}
              onChange={e => setSerial(e.target.value.toUpperCase())}
              placeholder="Scan or type serial number…"
              required
              style={{ fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.05em' }}
            />
            {lookingUp && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>Looking up…</div>}
          </div>

          {/* Brand + Model */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                Brand <span style={{ color: 'var(--red)' }}>*</span>
              </label>
              <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Segway" required />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                Model <span style={{ color: 'var(--red)' }}>*</span>
              </label>
              <input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Ninebot F40" required />
            </div>
          </div>

          {/* Source */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              Source <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(where did it come from?)</span>
            </label>
            <select value={source} onChange={e => setSource(e.target.value)}>
              <option value="">— Select source —</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Pallet */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              Assign to pallet
            </label>
            {pallets.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                No open B-grade pallets — <Link href="/pallets/new" style={{ color: 'var(--accent)' }}>create one first</Link>
              </div>
            ) : (
              <select value={palletId} onChange={e => setPalletId(e.target.value)}>
                <option value="">— No pallet —</option>
                {pallets.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.palletNumber}{p.locationCode ? ` · ${p.locationCode}` : ''} · {p._count?.items ?? 0}/{p.capacity}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Location */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              Current location
            </label>
            <select value={locationId} onChange={e => setLocationId(e.target.value)}>
              <option value="">— Not specified —</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              Condition notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Minor cosmetic damage, battery at 60%…"
              style={{ resize: 'vertical' }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: 'var(--red-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--red)' }}>
              {error}
            </div>
          )}

          <Btn variant="primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : '+ Create B-Grade entry'}
          </Btn>
        </div>
      </form>
    </div>
  )
}
