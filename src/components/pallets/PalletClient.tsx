'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'

type Item = {
  id:      string
  addedAt: string
  addedBy: string
  repairOrder: {
    id:          string
    orderNumber: string
    status:      string
    caseType:    string
    scooter:     { serialNumber: string; brand: string; model: string }
    customer:    { name: string } | null
    mechanic:    { name: string } | null
  }
}

type Props = {
  palletId:     string
  palletNumber: string
  isSealed:     boolean
  locationCode: string | null
  canEdit:      boolean
  items:        Item[]
}

export default function PalletClient({ palletId, palletNumber, isSealed, locationCode, canEdit, items }: Props) {
  const router = useRouter()
  const [addInput,  setAddInput]  = useState('')
  const [location,  setLocation]  = useState(locationCode ?? '')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')

  async function addCase() {
    const q = addInput.trim()
    if (!q) return
    setBusy(true); setError('')

    // Resolve orderNumber to caseId via scan API
    const res = await fetch(`/api/scan?q=${encodeURIComponent(q)}`)
    const body = await res.json()
    if (!res.ok || body.data?.matchType === 'pallet') {
      setBusy(false); setError('Could not find a repair case for that order number or serial'); return
    }

    const caseId = body.data.id
    const addRes = await fetch(`/api/pallets/${palletId}/items`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ repairOrderId: caseId }),
    })
    setBusy(false)
    if (addRes.ok) { setAddInput(''); router.refresh() }
    else { const b = await addRes.json(); setError(b.error ?? 'Failed to add to pallet') }
  }

  async function removeItem(repairOrderId: string) {
    setBusy(true)
    await fetch(`/api/pallets/${palletId}/items?repairOrderId=${repairOrderId}`, { method: 'DELETE' })
    setBusy(false)
    router.refresh()
  }

  async function updateLocation() {
    setBusy(true)
    await fetch(`/api/pallets/${palletId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ locationCode: location.trim().toUpperCase() || null }),
    })
    setBusy(false)
    router.refresh()
  }

  async function toggleSeal() {
    setBusy(true)
    await fetch(`/api/pallets/${palletId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isSealed: !isSealed }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Actions */}
      {canEdit && (
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>

            {/* Add case */}
            {!isSealed && (
              <div style={{ flex: 1, minWidth: 240 }}>
                <label style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
                  Add scooter (scan or type order # / serial)
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={addInput}
                    onChange={e => setAddInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCase()}
                    placeholder="RO-... or serial number"
                    style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  />
                  <Btn variant="primary" size="sm" disabled={busy || !addInput.trim()} onClick={addCase}>
                    Add
                  </Btn>
                </div>
              </div>
            )}

            {/* Location */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4, display: 'block' }}>
                Pallet location
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={location}
                  onChange={e => setLocation(e.target.value.toUpperCase())}
                  placeholder="e.g. BGRADE-R1-L2"
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
                <Btn variant="secondary" size="sm" disabled={busy} onClick={updateLocation}>
                  Save
                </Btn>
              </div>
            </div>

            {/* Seal */}
            <div>
              <Btn
                variant={isSealed ? 'secondary' : 'ghost'}
                size="sm"
                disabled={busy}
                onClick={toggleSeal}
              >
                {isSealed ? '🔓 Unseal pallet' : '🔒 Seal pallet'}
              </Btn>
            </div>
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {/* Items table */}
      <div className="card">
        {items.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No scooters in this pallet yet
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Scooter</th>
                <th>Serial</th>
                <th>Customer</th>
                <th>Mechanic</th>
                <th>Status</th>
                <th>Added</th>
                {canEdit && !isSealed && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/cases/${item.repairOrder.id}`} style={{ textDecoration: 'none' }}>
                      <span className="mono" style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
                        {item.repairOrder.orderNumber}
                      </span>
                    </Link>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text)' }}>
                    {item.repairOrder.scooter.brand} {item.repairOrder.scooter.model}
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {item.repairOrder.scooter.serialNumber}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {item.repairOrder.customer?.name ?? '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {item.repairOrder.mechanic?.name ?? '—'}
                  </td>
                  <td><StatusBadge status={item.repairOrder.status} /></td>
                  <td style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                    {new Date(item.addedAt).toLocaleDateString('en-GB')}
                    <span style={{ marginLeft: 4, color: 'var(--text-faint)' }}>· {item.addedBy}</span>
                  </td>
                  {canEdit && !isSealed && (
                    <td>
                      <Btn
                        variant="ghost" size="sm" disabled={busy}
                        onClick={() => removeItem(item.repairOrder.id)}
                      >
                        Remove
                      </Btn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
