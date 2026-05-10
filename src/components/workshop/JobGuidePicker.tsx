'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

/**
 * JobGuidePicker — model-specific repair guide picker.
 *
 * Replaces the Phase A v1 task checklist. Mechanics scan the dropdown
 * for guides matching this scooter's model, click one, and read it on
 * /repair-guides/[id]. The guide page has a Back-to-job button so the
 * mechanic returns to the same case.
 *
 * Empty state: when no guides match the model, we show a helpful note
 * pointing at all guides.
 */

export type GuideOption = {
  id:           string
  title:        string
  category:     string | null
  scooterModel: string
  brand:        string | null
}

type Props = {
  caseId:       string
  scooterBrand: string
  scooterModel: string
  guides:       GuideOption[]
}

export default function JobGuidePicker({
  caseId,
  scooterBrand,
  scooterModel,
  guides,
}: Props) {
  /* Optional category filter — small chip strip when there are guides
   * across multiple categories. */
  const categories = useMemo(() => {
    const set = new Set<string>()
    guides.forEach((g) => { if (g.category) set.add(g.category) })
    return Array.from(set).sort()
  }, [guides])

  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const visibleGuides = activeCategory
    ? guides.filter((g) => g.category === activeCategory)
    : guides

  const [selectedId, setSelectedId] = useState<string>('')

  const selected = visibleGuides.find((g) => g.id === selectedId) ?? null
  const returnTo = `/workshop/job/${caseId}`
  const openHref = selected
    ? `/repair-guides/${selected.id}?return=${encodeURIComponent(returnTo)}`
    : null

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="eyebrow" style={{ color: 'var(--text)', opacity: 0.7 }}>
          Repair guide
        </div>
        <span style={{ fontSize: 11, color: 'var(--sub)' }}>
          For{' '}
          <span className="mono" style={{ color: 'var(--accent-text)' }}>
            {scooterBrand} {scooterModel}
          </span>
        </span>
      </div>

      {guides.length === 0 ? (
        <div
          style={{
            padding:    '12px 0',
            fontSize:   13,
            color:      'var(--sub)',
            lineHeight: 1.55,
          }}
        >
          No guides yet for{' '}
          <span className="mono" style={{ color: 'var(--text)' }}>
            {scooterBrand} {scooterModel}
          </span>
          . Use your workshop knowledge for this one — and let your team know
          if a guide would help future repairs.
        </div>
      ) : (
        <>
          {/* Category chip filter */}
          {categories.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <CategoryChip
                label="All"
                active={activeCategory === null}
                onClick={() => { setActiveCategory(null); setSelectedId('') }}
              />
              {categories.map((c) => (
                <CategoryChip
                  key={c}
                  label={c}
                  active={activeCategory === c}
                  onClick={() => { setActiveCategory(c); setSelectedId('') }}
                />
              ))}
            </div>
          )}

          {/* Picker dropdown */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ flex: '1 1 260px', fontSize: 13 }}
            >
              <option value="">
                {visibleGuides.length === 0
                  ? 'No guides in this category'
                  : `Pick a guide… (${visibleGuides.length})`}
              </option>
              {visibleGuides.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                  {g.category ? ` · ${g.category}` : ''}
                </option>
              ))}
            </select>

            {openHref ? (
              <Link href={openHref}>
                <button
                  type="button"
                  className="btn btn-p"
                  style={{ height: 36 }}
                >
                  Open guide
                  <ChevronIcon />
                </button>
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-p"
                disabled
                style={{ height: 36, opacity: 0.5, cursor: 'not-allowed' }}
              >
                Open guide
                <ChevronIcon />
              </button>
            )}
          </div>

          {/* Selected guide preview line */}
          {selected && (
            <div
              style={{
                marginTop: 10,
                fontSize:  12,
                color:     'var(--sub)',
              }}
            >
              Opens in this tab — use the &ldquo;Back to job&rdquo; button on
              the guide to return to{' '}
              <span className="mono" style={{ color: 'var(--accent-text)' }}>
                this job
              </span>
              .
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label:   string
  active:  boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`filter-pill${active ? ' on' : ''}`}
      style={{ textTransform: 'capitalize' }}
    >
      {label}
    </button>
  )
}

function ChevronIcon() {
  return (
    <svg
      width={13} height={13} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
