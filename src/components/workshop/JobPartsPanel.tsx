'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * JobPartsPanel — parts logged against the case.
 *
 * Step 3 status:
 *   - Existing parts list rendered as static rows
 *     (name + SKU + bin location + qty).
 *   - Inline picker rendered: search-as-you-type against /api/parts,
 *     pick a part, set quantity, hit Add → POST /api/repairs/[id]/parts
 *     (existing endpoint, no schema change).
 *   - Stock warning if requested qty exceeds the part's stockQty.
 *   - Remove button NOT rendered: there's no remove endpoint server-side
 *     yet, and the spec already calls out that parts and inventory are
 *     append-only via stock movements. Removing is parked.
 */

export type JobRepairPart = {
  partId:           string
  quantity:         number
  name:             string
  sku:              string
  barcode:          string | null
  stockQty:         number
  warehouseLocation: string | null
  unitCost:         number | null
}

type CatalogPart = {
  id:                string
  sku:               string
  name:              string
  barcode:           string | null
  stockQty:          number
  warehouseLocation: string | null
}

/** Parts that the catalog flagged as compatible with this scooter's
 *  model — fed in from the server component so we don't need an extra
 *  client-side fetch. Each row shows name + bin location + stock with
 *  a low-stock warning at <= reorderLevel. */
export type CompatiblePart = {
  id:                string
  sku:               string
  name:              string
  warehouseLocation: string | null
  stockQty:          number
  reorderLevel:      number
}

type Props = {
  caseId:          string
  parts:           JobRepairPart[]
  compatibleParts: CompatiblePart[]
  scooterModel:    string
}

export default function JobPartsPanel({
  caseId,
  parts,
  compatibleParts,
  scooterModel,
}: Props) {
  const router = useRouter()

  /* Picker state.
   *
   * We deliberately separate "what the API last returned" from "what we
   * show". The displayed `results` is derived from the search length —
   * an empty search shows nothing — so the effect doesn't need to call
   * setState synchronously to clear stale results (which the React 19
   * `react-hooks/set-state-in-effect` rule flags). */
  const [search,         setSearch]         = useState('')
  const [fetched,        setFetched]        = useState<CatalogPart[]>([])
  const [searching,      setSearching]      = useState(false)
  const [selectedPart,   setSelectedPart]   = useState<CatalogPart | null>(null)
  const [quantity,       setQuantity]       = useState(1)
  const [adding,         setAdding]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  const searchActive = search.trim().length >= 2
  const results = searchActive ? fetched : []

  /* Debounced search against /api/parts.
   *
   * setSearching/setFetched live INSIDE the setTimeout callback, not in
   * the effect body — `react-hooks/set-state-in-effect` flags any
   * synchronous setState in an effect body. Calls inside async
   * callbacks (setTimeout, fetch.then) are fine. */
  useEffect(() => {
    if (!searchActive) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setSearching(true)
      fetch(`/api/parts?search=${encodeURIComponent(search.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return
          // /api/parts returns either an array directly or { data: [...] }
          // depending on which handler shape it uses. Normalise.
          const list: CatalogPart[] =
            Array.isArray(d) ? d
            : Array.isArray(d?.data) ? d.data
            : []
          setFetched(list.slice(0, 8))
        })
        .catch(() => {
          if (!cancelled) setFetched([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, searchActive])

  function pickPart(p: CatalogPart) {
    setSelectedPart(p)
    setSearch(p.name)
    setFetched([])
    setError(null)
  }

  async function addPart() {
    if (!selectedPart) {
      setError('Pick a part from the search results first.')
      return
    }
    if (quantity < 1) {
      setError('Quantity must be at least 1.')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`/api/repairs/${caseId}/parts`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ partId: selectedPart.id, quantity }),
      })
      if (res.ok) {
        setSelectedPart(null)
        setSearch('')
        setQuantity(1)
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to add part')
      }
    } finally {
      setAdding(false)
    }
  }

  const overStock =
    selectedPart != null && quantity > selectedPart.stockQty

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
      <div className="eyebrow" style={{ marginBottom: 10, color: 'var(--text)', opacity: 0.7 }}>
        Parts used
      </div>

      {/* Existing parts */}
      {parts.length === 0 ? (
        <div
          style={{
            padding:    '12px 0',
            fontSize:   13,
            color:      'var(--sub)',
          }}
        >
          No parts added yet.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {parts.map((rp) => (
            <li
              key={rp.partId}
              style={{
                display:        'grid',
                gridTemplateColumns: '1fr auto',
                gap:            12,
                alignItems:     'center',
                padding:        '10px 12px',
                border:         '1px solid var(--border)',
                borderRadius:   'var(--radius-md)',
                background:     'var(--surface)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                  {rp.name}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--sub)' }}>
                  {rp.sku}
                  {rp.warehouseLocation && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--accent-text)' }}>
                        {rp.warehouseLocation}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <span
                className="mono"
                style={{
                  fontSize:    12,
                  fontWeight:  600,
                  color:       'var(--text)',
                  background:  'var(--s2)',
                  padding:     '4px 10px',
                  borderRadius:999,
                }}
              >
                ×{rp.quantity}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Compatible parts for this scooter model.
       *
       * Sourced from Part.compatibleModels matched against the scooter's
       * model. Each row shows the bin location prominently (so the
       * mechanic walks straight to it) and the live stock count with
       * a low-stock pill at or below reorderLevel.
       *
       * Click "Use" on any row to pre-fill the picker below with that
       * part. */}
      {compatibleParts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--accent-text)' }}>
            Compatible parts for {scooterModel}
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding:   0,
              margin:    0,
              display:   'flex',
              flexDirection: 'column',
              gap:       4,
            }}
          >
            {compatibleParts.map((cp) => {
              const lowStock = cp.stockQty <= cp.reorderLevel
              const outOfStock = cp.stockQty <= 0
              return (
                <li
                  key={cp.id}
                  style={{
                    display:        'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap:            10,
                    alignItems:     'center',
                    padding:        '8px 10px',
                    border:         '1px solid var(--border)',
                    borderRadius:   'var(--radius-md)',
                    background:     'var(--s2)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                      {cp.name}
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--sub)' }}>
                      {cp.sku}
                      {cp.warehouseLocation && (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--accent-text)' }}>
                            {cp.warehouseLocation}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize:     11,
                      fontWeight:   600,
                      padding:      '3px 9px',
                      borderRadius: 999,
                      background:   outOfStock
                        ? 'var(--red-bg)'
                        : lowStock
                          ? 'var(--amber-bg)'
                          : 'var(--green-bg)',
                      color:        outOfStock
                        ? 'var(--red-text)'
                        : lowStock
                          ? 'var(--amber-text)'
                          : 'var(--green-text)',
                    }}
                    title={
                      outOfStock
                        ? 'Out of stock'
                        : lowStock
                          ? `Low — reorder level is ${cp.reorderLevel}`
                          : 'In stock'
                    }
                  >
                    {outOfStock ? 'Out' : `${cp.stockQty} in stock`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-s"
                    style={{ height: 28, fontSize: 12 }}
                    disabled={outOfStock}
                    title={outOfStock ? 'No stock left' : 'Pre-fill the add-part box below'}
                    onClick={() => {
                      setSelectedPart({
                        id:                cp.id,
                        sku:               cp.sku,
                        name:              cp.name,
                        barcode:           null,
                        stockQty:          cp.stockQty,
                        warehouseLocation: cp.warehouseLocation,
                      })
                      setSearch(cp.name)
                      setError(null)
                    }}
                  >
                    Use
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Picker */}
      <div
        style={{
          marginTop:    12,
          padding:      12,
          border:       '1px dashed var(--border2)',
          borderRadius: 'var(--radius-md)',
          background:   'var(--s2)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 6 }}>Add a part</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by name, SKU, or barcode…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (selectedPart) setSelectedPart(null)
            }}
            disabled={adding}
            style={{ flex: '1 1 220px', fontSize: 13 }}
          />
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            disabled={adding}
            style={{ width: 80, fontSize: 13 }}
          />
          <Btn variant="primary" onClick={addPart} loading={adding}>
            Add
          </Btn>

          {/* Search results popover */}
          {results.length > 0 && (
            <div
              style={{
                position:     'absolute',
                top:          '100%',
                left:         0,
                right:        0,
                marginTop:    4,
                background:   'var(--surface)',
                border:       '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                boxShadow:    'var(--card-sh)',
                zIndex:       3,
                maxHeight:    260,
                overflowY:    'auto',
              }}
            >
              {results.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => pickPart(p)}
                  style={{
                    all:           'unset',
                    display:       'flex',
                    alignItems:    'center',
                    justifyContent:'space-between',
                    gap:           10,
                    padding:       '10px 12px',
                    width:         '100%',
                    cursor:        'pointer',
                    fontSize:      13,
                    color:         'var(--text)',
                    borderBottom:  '1px solid var(--border)',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--sub)', marginLeft: 8 }}>
                      {p.sku}
                    </span>
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize:   11,
                      color:      p.stockQty <= 0 ? 'var(--red-text)' : 'var(--sub)',
                      flexShrink: 0,
                    }}
                  >
                    Stock {p.stockQty}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {searching && (
          <div style={{ fontSize: 11, color: 'var(--sub)', marginTop: 6 }}>
            Searching…
          </div>
        )}

        {selectedPart && (
          <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>
            Selected: <strong style={{ color: 'var(--text)' }}>{selectedPart.name}</strong>{' '}
            <span className="mono">({selectedPart.sku})</span>
            {selectedPart.warehouseLocation && (
              <> · bin <span className="mono" style={{ color: 'var(--accent-text)' }}>{selectedPart.warehouseLocation}</span></>
            )}
          </div>
        )}

        {overStock && (
          <div
            style={{
              fontSize:   12,
              color:      'var(--amber-text)',
              background: 'var(--amber-bg)',
              padding:    '6px 10px',
              borderRadius: 6,
              marginTop:  8,
            }}
          >
            Heads up — only {selectedPart!.stockQty} in stock. Adding{' '}
            {quantity} will go negative or fail.
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red-text)', marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
