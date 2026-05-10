'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Rack     = { id: string; name: string; code: string; type: string; isActive: boolean }
type ZoneData = { id: string; name: string; code: string; type: string; isActive: boolean; children: Rack[] }

type Props = {
  caseId:          string
  currentLocation: { id?: string; name: string; code: string } | null
  canEdit:         boolean
}

export default function LocationPicker({ caseId, currentLocation, canEdit }: Props) {
  const router = useRouter()
  const [editing,  setEditing]  = useState(false)
  const [zones,    setZones]    = useState<ZoneData[]>([])
  const [selected, setSelected] = useState('')
  const [busy,     setBusy]     = useState(false)

  useEffect(() => {
    if (!editing) return
    fetch('/api/locations')
      .then(r => r.json())
      .then(d => setZones(Array.isArray(d.data) ? d.data.filter((z: ZoneData) => z.isActive) : []))
      .catch(() => setZones([]))
  }, [editing])

  async function save() {
    setBusy(true)
    await fetch(`/api/cases/${caseId}/location`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ locationId: selected || null }),
    })
    setBusy(false)
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:12, color: currentLocation?'var(--text)':'var(--text-faint)', fontWeight: currentLocation?500:400 }}>
          {currentLocation ? currentLocation.name : 'Not set'}
        </span>
        {currentLocation && (
          <span className="mono" style={{ fontSize:10, color:'var(--text-faint)' }}>{currentLocation.code}</span>
        )}
        {canEdit && (
          <button onClick={()=>setEditing(true)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:'var(--accent)', padding:'0 4px' }}>
            {currentLocation ? 'Move' : 'Set location'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
      <select value={selected} onChange={e=>setSelected(e.target.value)} style={{ fontSize:12, minWidth:180 }}>
        <option value="">— Clear location —</option>
        {zones.length === 0 && <option disabled>Loading…</option>}
        {zones.map(zone => (
          <optgroup key={zone.id} label={`${zone.name} (${zone.code})`}>
            <option value={zone.id}>{zone.name} — whole zone</option>
            {zone.children.filter(r=>r.isActive).map(rack => (
              <option key={rack.id} value={rack.id}>  ▤ {rack.name} ({rack.code})</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button onClick={save} disabled={busy} style={{ padding:'4px 12px', fontSize:12, fontWeight:600, background:'var(--accent)', color:'#fff', border:'none', borderRadius:'var(--radius)', cursor:'pointer' }}>
        {busy ? '…' : 'Save'}
      </button>
      <button onClick={()=>setEditing(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-faint)' }}>
        Cancel
      </button>
    </div>
  )
}
