'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

type Location = {
  id:          string
  name:        string
  code:        string
  type:        string
  typeLabel:   string
  description: string | null
  isActive:    boolean
  activeCases: number
}

const TYPE_COLOURS: Record<string, string> = {
  INBOUND_AREA:   'var(--accent)',
  WARRANTY_RACK:  'var(--purple)',
  BGRADE_AREA:    'var(--amber)',
  MECHANIC_QUEUE: 'var(--green)',
  QC_RACK:        'var(--red)',
  DISPATCH_AREA:  '#1a7f37',
  STORAGE:        'var(--text-faint)',
}

const LOCATION_TYPES = [
  'INBOUND_AREA', 'WARRANTY_RACK', 'BGRADE_AREA',
  'MECHANIC_QUEUE', 'QC_RACK', 'DISPATCH_AREA', 'STORAGE',
]
const TYPE_LABELS: Record<string, string> = {
  INBOUND_AREA:   'Inbound Area',
  WARRANTY_RACK:  'Warranty Rack',
  BGRADE_AREA:    'B-Grade Area',
  MECHANIC_QUEUE: 'Mechanic Queue',
  QC_RACK:        'QC Rack',
  DISPATCH_AREA:  'Dispatch Area',
  STORAGE:        'Storage',
}

export default function LocationsClient({ locations, isAdmin }: { locations: Location[]; isAdmin: boolean }) {
  const router = useRouter()
  const [showAdd,   setShowAdd]   = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [editId,    setEditId]    = useState<string | null>(null)
  const [editName,  setEditName]  = useState('')
  const [editDesc,  setEditDesc]  = useState('')

  const [name,  setName]  = useState('')
  const [code,  setCode]  = useState('')
  const [type,  setType]  = useState('INBOUND_AREA')
  const [desc,  setDesc]  = useState('')

  async function addLocation() {
    if (!name.trim() || !code.trim()) { setError('Name and code are required'); return }
    setBusy(true); setError('')
    const res = await fetch('/api/locations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: name.trim(), code: code.trim().toUpperCase(), type, description: desc.trim() || undefined }),
    })
    setBusy(false)
    if (res.ok) { setShowAdd(false); setName(''); setCode(''); setDesc(''); router.refresh() }
    else { const b = await res.json(); setError(b.error ?? 'Failed to create location') }
  }

  async function toggleActive(id: string, current: boolean) {
    setBusy(true)
    await fetch(`/api/locations/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ isActive: !current }),
    })
    setBusy(false)
    router.refresh()
  }

  async function saveEdit(id: string) {
    setBusy(true); setError('')
    const res = await fetch(`/api/locations/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: editName.trim(), description: editDesc.trim() || undefined }),
    })
    setBusy(false)
    if (res.ok) { setEditId(null); router.refresh() }
    else { const b = await res.json(); setError(b.error ?? 'Failed to update') }
  }

  return (
    <div>
      {isAdmin && (
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="primary" size="sm" onClick={() => setShowAdd(v => !v)}>
            {showAdd ? 'Cancel' : '+ Add location'}
          </Btn>
        </div>
      )}

      {showAdd && (
        <div className="card" style={{ padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>New warehouse location</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. QC Rack B" />
            </div>
            <div>
              <label>Code <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>(unique, uppercase)</span></label>
              <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. QC_B" maxLength={20} style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div>
              <label>Type</label>
              <select value={type} onChange={e => setType(e.target.value)}>
                {LOCATION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label>Description <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>(optional)</span></label>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Brief description…" />
            </div>
          </div>
          {error && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</div>}
          <Btn variant="primary" size="sm" disabled={busy} onClick={addLocation}>
            {busy ? 'Saving…' : 'Create location'}
          </Btn>
        </div>
      )}

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Code</th>
              <th>Type</th>
              <th>Active cases</th>
              <th>Status</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {locations.map(loc => (
              <tr key={loc.id} style={{ opacity: loc.isActive ? 1 : 0.5 }}>
                <td>
                  {editId === loc.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)} style={{ padding: '3px 7px', fontSize: 13 }} />
                      <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description…" style={{ padding: '3px 7px', fontSize: 12 }} />
                      <Btn variant="primary" size="sm" disabled={busy} onClick={() => saveEdit(loc.id)}>Save</Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setEditId(null)}>Cancel</Btn>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{loc.name}</div>
                      {loc.description && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{loc.description}</div>}
                    </div>
                  )}
                </td>
                <td>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{loc.code}</span>
                </td>
                <td>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: `${TYPE_COLOURS[loc.type]}22`,
                    color: TYPE_COLOURS[loc.type] ?? 'var(--text-muted)',
                    fontWeight: 600,
                  }}>
                    {loc.typeLabel}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: 13, fontWeight: loc.activeCases > 0 ? 600 : 400, color: loc.activeCases > 0 ? 'var(--text)' : 'var(--text-faint)' }}>
                    {loc.activeCases}
                  </span>
                </td>
                <td>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                    background: loc.isActive ? 'var(--green-bg)' : 'var(--bg-raised)',
                    color: loc.isActive ? 'var(--green)' : 'var(--text-faint)',
                  }}>
                    {loc.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {isAdmin && (
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn variant="ghost" size="sm" disabled={busy} onClick={() => { setEditId(loc.id); setEditName(loc.name); setEditDesc(loc.description ?? '') }}>
                        Edit
                      </Btn>
                      <Btn variant="ghost" size="sm" disabled={busy || loc.activeCases > 0} onClick={() => toggleActive(loc.id, loc.isActive)}>
                        {loc.isActive ? 'Deactivate' : 'Activate'}
                      </Btn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {locations.length === 0 && (
              <tr><td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: 32 }}>No locations defined</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
