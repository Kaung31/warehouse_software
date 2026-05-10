'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Zone = {
  id:       string
  name:     string
  code:     string
  capacity: number
  _count:   { cases: number }
}

function zoneColor(pct: number) {
  if (pct < 0.6) return { fill: 'var(--green)', count: 'var(--green)' }
  if (pct < 0.8) return { fill: 'var(--amber)', count: 'var(--amber)' }
  if (pct < 1)   return { fill: 'var(--orange)', count: 'var(--orange)' }
  return { fill: 'var(--red)', count: 'var(--red)' }
}

export default function ZoneBar() {
  const router = useRouter()
  const [zones, setZones] = useState<Zone[]>([])

  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setZones(d.data) })
      .catch(() => {})
  }, [])

  return (
    <div className="zone-bar">
      <span className="zb-label">⊞ Zones</span>

      {zones.map(z => {
        const count = z._count?.cases ?? 0
        const cap   = z.capacity > 0 ? z.capacity : 20
        const pct   = Math.min(count / cap, 1)
        const cl    = zoneColor(pct)
        return (
          <div
            key={z.id}
            className="zb-zone"
            onClick={() => router.push('/locations')}
            title={`${z.name}: ${count}/${cap}`}
          >
            <span className="zb-name">{z.name}</span>
            <div className="zb-mini">
              <div
                className="zb-fill"
                style={{ width: `${pct * 100}%`, background: cl.fill }}
              />
            </div>
            <span className="zb-count" style={{ color: cl.count }}>{count}/{cap}</span>
          </div>
        )
      })}

      {zones.length === 0 && (
        <span style={{ fontSize: 10, color: 'var(--sub)', marginLeft: 8 }}>Loading zones…</span>
      )}

      <div
        className="zb-scan"
        onClick={() => router.push('/scan')}
        style={{ cursor: 'pointer' }}
        title="Quick scan"
      >
        <span className="led" />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
          SCANNER READY
        </span>
      </div>
    </div>
  )
}
