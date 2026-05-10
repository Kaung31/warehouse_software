import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

/**
 * /repair-guides — index page listing all guides.
 *
 * Server-rendered with two URL-driven filters:
 *   - ?model=Pure+Air+Pro   (case-insensitive substring on scooterModel)
 *   - ?category=brakes      (exact match on category)
 *
 * Mechanics get to here from the sidebar nav, or from a job page via
 * the JobGuidePicker. Both flows are read-only — guide authoring will
 * land in a future phase.
 */

type Ctx = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function RepairGuidesIndex(ctx: Ctx) {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  const sp        = await ctx.searchParams
  const modelQ    = typeof sp.model    === 'string' ? sp.model.trim()    : ''
  const categoryQ = typeof sp.category === 'string' ? sp.category.trim() : ''

  const guides = await prisma.repairGuide.findMany({
    where: {
      ...(modelQ
        ? { scooterModel: { contains: modelQ, mode: 'insensitive' } }
        : {}),
      ...(categoryQ ? { category: categoryQ } : {}),
    },
    orderBy: [{ scooterModel: 'asc' }, { category: 'asc' }, { title: 'asc' }],
    select: {
      id:           true,
      title:        true,
      scooterModel: true,
      brand:        true,
      category:     true,
    },
  })

  // Distinct values for the filter chips. Computed on a separate
  // unfiltered query so the chips don't collapse as you filter.
  const allGuides = await prisma.repairGuide.findMany({
    select: { scooterModel: true, category: true },
  })
  const allCategories = Array.from(
    new Set(allGuides.map((g) => g.category).filter(Boolean) as string[]),
  ).sort()

  return (
    <div
      className="fade-up"
      style={{
        display:       'flex',
        flexDirection: 'column',
        gap:           18,
        maxWidth:      1100,
        margin:        '0 auto',
      }}
    >
      {/* Header */}
      <div>
        <div className="eyebrow" style={{ color: 'var(--sub)', marginBottom: 4 }}>
          Knowledge base
        </div>
        <h1 className="page-title" style={{ marginBottom: 2 }}>
          Repair guides
        </h1>
        <div style={{ fontSize: 13, color: 'var(--sub)' }}>
          {guides.length} guide{guides.length === 1 ? '' : 's'}
          {modelQ    && ` matching "${modelQ}"`}
          {categoryQ && ` in ${categoryQ}`}
        </div>
      </div>

      {/* Filters */}
      <form
        action="/repair-guides"
        method="get"
        style={{
          display:    'flex',
          gap:        10,
          flexWrap:   'wrap',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          name="model"
          defaultValue={modelQ}
          placeholder="Filter by scooter model (e.g. Pure Air Pro)"
          style={{ flex: '1 1 240px', fontSize: 13 }}
        />

        {/* Category chips. Use links so the URL stays the source of truth. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Link
            href={`/repair-guides${modelQ ? `?model=${encodeURIComponent(modelQ)}` : ''}`}
            className={`filter-pill${categoryQ === '' ? ' on' : ''}`}
          >
            All
          </Link>
          {allCategories.map((c) => {
            const params = new URLSearchParams()
            if (modelQ) params.set('model', modelQ)
            params.set('category', c)
            return (
              <Link
                key={c}
                href={`/repair-guides?${params.toString()}`}
                className={`filter-pill${categoryQ === c ? ' on' : ''}`}
                style={{ textTransform: 'capitalize' }}
              >
                {c}
              </Link>
            )
          })}
        </div>

        <button
          type="submit"
          className="btn btn-s"
          style={{ height: 36, fontSize: 13 }}
        >
          Search
        </button>
      </form>

      {/* Results */}
      {guides.length === 0 ? (
        <div
          style={{
            background:    'var(--surface)',
            border:        '1px dashed var(--border)',
            borderRadius:  'var(--radius-lg)',
            padding:       28,
            textAlign:     'center',
            color:         'var(--sub)',
            fontSize:      13,
          }}
        >
          No guides match those filters.
        </div>
      ) : (
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap:                 12,
          }}
        >
          {guides.map((g) => (
            <Link
              key={g.id}
              href={`/repair-guides/${g.id}`}
              style={{
                textDecoration: 'none',
                color:          'inherit',
                background:     'var(--surface)',
                border:         '1px solid var(--border)',
                borderRadius:   'var(--radius-lg)',
                padding:        '16px 18px',
                boxShadow:      'var(--card-sh)',
                display:        'flex',
                flexDirection:  'column',
                gap:            8,
                transition:     'border-color .12s, transform .12s',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span
                  className="mono"
                  style={{
                    fontSize:    11,
                    fontWeight:  500,
                    padding:     '2px 8px',
                    borderRadius:999,
                    background:  'var(--accent-dim)',
                    color:       'var(--accent-text)',
                  }}
                >
                  {g.brand ? `${g.brand} ` : ''}{g.scooterModel}
                </span>
                {g.category && (
                  <span
                    style={{
                      fontSize:      10,
                      fontWeight:    600,
                      textTransform: 'uppercase',
                      letterSpacing: '.06em',
                      padding:       '2px 8px',
                      borderRadius:  999,
                      background:    'var(--s2)',
                      color:         'var(--sub)',
                    }}
                  >
                    {g.category}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize:   14,
                  fontWeight: 600,
                  color:      'var(--text)',
                  lineHeight: 1.4,
                }}
              >
                {g.title}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
