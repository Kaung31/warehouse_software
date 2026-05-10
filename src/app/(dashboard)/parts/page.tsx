import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'

/**
 * Parts & inventory page.
 *
 * v2 changes (April 2026):
 *   • 4-tile stat strip: Total · Low stock · Out of stock · Models tracked.
 *   • Search bar uses .search-wrap; supports name / SKU / barcode.
 *   • Compatible-model filter chips (extracted from `compatibleModels`).
 *   • Quick filter chips: All / Low stock / Out of stock.
 *   • Puzzler-style row layout (no more <table>) — each part is a card-row
 *     with thumbnail, name+SKU, bin location pill (prominent — pin icon
 *     matches the MechanicPanel pattern), compatible-model chips, stock
 *     count with traffic-light color + status pill, retail price.
 *   • Low-stock rows get amber tint; out-of-stock rows get red tint.
 *   • Uses the new `retailPrice` field added in Phase 3 schema migration.
 *   • Sort dropdown.
 *
 * Bug fix in this revision:
 *   • Filter pills with icons + label rendered the icon on a new line.
 *     Wrapped pill content in a <span> with display:inline-flex + gap so
 *     icon and text always sit on the same line.
 *
 * Prisma fix: column-vs-column lte (stockQty <= reorderLevel) replaced
 * with $queryRaw — Prisma's typed API doesn't support that natively.
 */

type PartFilter = 'all' | 'low' | 'out'
type SortBy = 'name' | 'stock-low' | 'sku' | 'updated'

export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string
    filter?: string
    model?: string
    sort?: string
    page?: string
  }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const sp = await searchParams
  const search = sp.search?.trim() ?? ''
  const filter: PartFilter =
    sp.filter === 'low' ? 'low' : sp.filter === 'out' ? 'out' : 'all'
  const modelFilter = sp.model?.trim() ?? ''
  const sort: SortBy =
    sp.sort === 'stock-low'
      ? 'stock-low'
      : sp.sort === 'sku'
      ? 'sku'
      : sp.sort === 'updated'
      ? 'updated'
      : 'name'
  const page = Math.max(1, parseInt(sp.page ?? '1'))
  const perPage = 30

  /* ─── Build base where clause ─────────────────────────────────────── */
  const baseWhere: Prisma.PartWhereInput = { isActive: true }
  if (search) {
    baseWhere.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ]
  }
  if (modelFilter) {
    baseWhere.compatibleModels = { contains: modelFilter, mode: 'insensitive' }
  }

  /* ─── Order ──────────────────────────────────────────────────────── */
  const orderBy: Prisma.PartOrderByWithRelationInput =
    sort === 'stock-low'
      ? { stockQty: 'asc' }
      : sort === 'sku'
      ? { sku: 'asc' }
      : sort === 'updated'
      ? { updatedAt: 'desc' }
      : { name: 'asc' }

  /* ─── Stats: low-stock + out-of-stock counts ──────────────────────── */
  const lowStockRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Part"
    WHERE "isActive" = true AND "stockQty" <= "reorderLevel"
  `
  const lowStockCount = lowStockRows.length
  const outOfStockCount = await prisma.part.count({
    where: { isActive: true, stockQty: { lte: 0 } },
  })

  let lowStockIds: Set<string> | null = null
  if (filter === 'low') {
    lowStockIds = new Set(lowStockRows.map(r => r.id))
  }

  const where: Prisma.PartWhereInput = { ...baseWhere }
  if (filter === 'out') {
    where.stockQty = { lte: 0 }
  } else if (filter === 'low' && lowStockIds) {
    where.id = { in: Array.from(lowStockIds) }
  }

  /* ─── Fetch paginated parts ───────────────────────────────────────── */
  const [parts, total] = await Promise.all([
    prisma.part.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.part.count({ where }),
  ])

  /* ─── Extract unique compatible models for the model filter ────────── */
  const allParts = await prisma.part.findMany({
    where: { isActive: true, compatibleModels: { not: null } },
    select: { compatibleModels: true },
  })
  const modelCount = new Map<string, number>()
  for (const p of allParts) {
    if (!p.compatibleModels) continue
    for (const m of p.compatibleModels.split(',').map(s => s.trim())) {
      if (!m) continue
      modelCount.set(m, (modelCount.get(m) ?? 0) + 1)
    }
  }
  const topModels = Array.from(modelCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => name)

  const totalPages = Math.ceil(total / perPage)

  /* ─── URL builder ─────────────────────────────────────────────────── */
  function buildHref(
    overrides: Partial<{
      filter: string
      model: string
      sort: string
      search: string
      page: number
    }>
  ): string {
    const params = new URLSearchParams()
    const f = overrides.filter ?? (filter === 'all' ? '' : filter)
    const m = overrides.model ?? modelFilter
    const s = overrides.sort ?? (sort === 'name' ? '' : sort)
    const q = overrides.search ?? search
    const p = overrides.page
    if (f) params.set('filter', f)
    if (m) params.set('model', m)
    if (s) params.set('sort', s)
    if (q) params.set('search', q)
    if (p && p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/parts${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="fade-up">
      <PageHeader
        title="Parts & inventory"
        sub={`${total} part${total === 1 ? '' : 's'}${
          lowStockCount > 0 ? ` · ${lowStockCount} low stock` : ''
        }`}
      />

      {/* ── Stat strip ── */}
      <div className="grid4" style={{ marginBottom: 18 }}>
        <StatTile label="Total parts" value={total} />
        <StatTile
          label="Low stock"
          value={lowStockCount}
          tone={lowStockCount > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Out of stock"
          value={outOfStockCount}
          tone={outOfStockCount > 0 ? 'danger' : 'neutral'}
        />
        <StatTile label="Models tracked" value={topModels.length} />
      </div>

      {/* ── Search + sort row ── */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <form
          className="search-wrap"
          style={{ flex: 1, minWidth: 240, display: 'flex' }}
        >
          <span className="search-icon">
            <SearchIcon />
          </span>
          <input
            name="search"
            defaultValue={search}
            placeholder="Search name, SKU, barcode…"
            autoComplete="off"
          />
          {modelFilter && (
            <input type="hidden" name="model" value={modelFilter} />
          )}
          {filter !== 'all' && (
            <input type="hidden" name="filter" value={filter} />
          )}
          {sort !== 'name' && (
            <input type="hidden" name="sort" value={sort} />
          )}
        </form>

        <form style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label
            htmlFor="sort"
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              fontWeight: 500,
              marginBottom: 0,
            }}
          >
            Sort
          </label>
          {search && <input type="hidden" name="search" value={search} />}
          {modelFilter && (
            <input type="hidden" name="model" value={modelFilter} />
          )}
          {filter !== 'all' && (
            <input type="hidden" name="filter" value={filter} />
          )}
          <select
            id="sort"
            name="sort"
            defaultValue={sort}
            style={{ width: 'auto', minWidth: 130 }}
          >
            <option value="name">Name (A→Z)</option>
            <option value="stock-low">Stock (low first)</option>
            <option value="sku">SKU</option>
            <option value="updated">Recently updated</option>
          </select>
          <Btn variant="secondary" size="sm" type="submit">
            Apply
          </Btn>
        </form>
      </div>

      {/* ── Filter pills row ── */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Link href={buildHref({ filter: '' })}>
          <span className={`filter-pill${filter === 'all' ? ' on' : ''}`}>
            <PillContent>All parts</PillContent>
          </span>
        </Link>
        <Link href={buildHref({ filter: 'low' })}>
          <span className={`filter-pill${filter === 'low' ? ' on' : ''}`}>
            <PillContent icon={<AlertIcon />}>
              Low stock
              {lowStockCount > 0 && (
                <span
                  className="mono"
                  style={{ marginLeft: 6, opacity: 0.7 }}
                >
                  {lowStockCount}
                </span>
              )}
            </PillContent>
          </span>
        </Link>
        <Link href={buildHref({ filter: 'out' })}>
          <span className={`filter-pill${filter === 'out' ? ' on' : ''}`}>
            <PillContent icon={<XIcon />}>
              Out of stock
              {outOfStockCount > 0 && (
                <span
                  className="mono"
                  style={{ marginLeft: 6, opacity: 0.7 }}
                >
                  {outOfStockCount}
                </span>
              )}
            </PillContent>
          </span>
        </Link>
      </div>

      {/* ── Model filter row ── */}
      {topModels.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 18,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <span
            className="eyebrow"
            style={{ marginRight: 6, color: 'var(--text-faint)' }}
          >
            Compatible model
          </span>
          <Link href={buildHref({ model: '' })}>
            <span className={`filter-pill${!modelFilter ? ' on' : ''}`}>
              <PillContent>Any</PillContent>
            </span>
          </Link>
          {topModels.map(m => (
            <Link key={m} href={buildHref({ model: m })}>
              <span
                className={`filter-pill${modelFilter === m ? ' on' : ''}`}
              >
                <PillContent>{m}</PillContent>
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Parts list ── */}
      {parts.length === 0 ? (
        <EmptyState search={search} filter={filter} model={modelFilter} />
      ) : (
        <div className="row-grid">
          {parts.map(p => (
            <PartRow key={p.id} part={p} />
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 6,
            padding: '20px 0 8px',
            flexWrap: 'wrap',
          }}
        >
          <Link href={buildHref({ page: Math.max(1, page - 1) })}>
            <span className={`filter-pill${page === 1 ? ' on' : ''}`}>
              <PillContent>← Prev</PillContent>
            </span>
          </Link>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              p => p === 1 || p === totalPages || Math.abs(p - page) <= 2
            )
            .map((p, i, arr) => (
              <span key={p} style={{ display: 'inline-flex', gap: 6 }}>
                {i > 0 && arr[i - 1] !== p - 1 && (
                  <span
                    style={{
                      padding: '5px 10px',
                      color: 'var(--text-faint)',
                      fontSize: 11,
                    }}
                  >
                    …
                  </span>
                )}
                <Link href={buildHref({ page: p })}>
                  <span
                    className={`filter-pill${p === page ? ' on' : ''}`}
                  >
                    <PillContent>{p}</PillContent>
                  </span>
                </Link>
              </span>
            ))}
          <Link href={buildHref({ page: Math.min(totalPages, page + 1) })}>
            <span
              className={`filter-pill${page === totalPages ? ' on' : ''}`}
            >
              <PillContent>Next →</PillContent>
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

/**
 * PillContent — wraps any content placed inside a .filter-pill.
 * Forces inline-flex so an icon + label always sit on the same line,
 * regardless of how the parent .filter-pill class lays out its children.
 * Fixes the icon-on-its-own-line bug.
 */
function PillContent({
  children,
  icon,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      {icon && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}


function PartRow({
  part,
}: {
  part: {
    id: string
    name: string
    sku: string
    barcode: string | null
    stockQty: number
    reorderLevel: number
    warehouseLocation: string | null
    compatibleModels: string | null
    unitCost: unknown
    retailPrice: unknown
    supplierName: string | null
  }
}) {
  const isLow = part.stockQty <= part.reorderLevel
  const isOut = part.stockQty <= 0

  const stockColor = isOut
    ? 'var(--red-text)'
    : isLow
    ? 'var(--amber-text)'
    : 'var(--green-text)'

  const rowClass = isOut
    ? 'row-grid-item danger'
    : isLow
    ? 'row-grid-item warn'
    : 'row-grid-item'

  const models = part.compatibleModels
    ? part.compatibleModels
        .split(',')
        .map(m => m.trim())
        .filter(Boolean)
    : []

  const retailPrice =
    part.retailPrice != null
      ? `£${Number(part.retailPrice).toFixed(2)}`
      : null

  return (
    <div className={rowClass}>
      <div
        className="thumb thumb-md"
        style={{ background: 'var(--s2)', color: 'var(--sub)' }}
        aria-label={part.name}
      >
        <PartIcon />
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 2,
          }}
        >
          {part.name}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--sub)',
          }}
        >
          <span className="mono">{part.sku}</span>
          {part.barcode && (
            <>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              <span className="mono" style={{ opacity: 0.7 }}>
                {part.barcode}
              </span>
            </>
          )}
        </div>
      </div>

      <div>
        {part.warehouseLocation ? (
          <span
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 500,
              background: 'var(--accent-dim)',
              color: 'var(--accent-text)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}
            title="Bin location"
          >
            <PinIcon />
            {part.warehouseLocation}
          </span>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              fontStyle: 'italic',
            }}
          >
            No location
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          maxWidth: 220,
        }}
      >
        {models.length > 0 ? (
          <>
            {models.slice(0, 3).map(m => (
              <span
                key={m}
                className="filter-pill"
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  cursor: 'default',
                }}
              >
                <PillContent>{m}</PillContent>
              </span>
            ))}
            {models.length > 3 && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  alignSelf: 'center',
                }}
              >
                +{models.length - 3}
              </span>
            )}
          </>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              fontStyle: 'italic',
            }}
          >
            All models
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 2,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 4,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: stockColor,
            }}
          >
            {part.stockQty}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            / {part.reorderLevel}
          </span>
        </div>
        {isOut ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--red-text)',
              background: 'var(--red-bg)',
              padding: '1px 7px',
              borderRadius: 999,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            Out of stock
          </span>
        ) : isLow ? (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: 'var(--amber-text)',
              background: 'var(--amber-bg)',
              padding: '1px 7px',
              borderRadius: 999,
              textTransform: 'uppercase',
              letterSpacing: '.05em',
            }}
          >
            Low stock
          </span>
        ) : (
          retailPrice && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--sub)',
                fontWeight: 500,
              }}
              title="Retail price"
            >
              {retailPrice}
            </span>
          )
        )}
      </div>
    </div>
  )
}


function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'neutral' | 'warn' | 'danger'
}) {
  const styles =
    tone === 'warn' && value > 0
      ? {
          background: 'var(--amber-bg)',
          borderColor: 'transparent',
          numColor: 'var(--amber-text)',
          labelColor: 'var(--amber-text)',
        }
      : tone === 'danger' && value > 0
      ? {
          background: 'var(--red-bg)',
          borderColor: 'transparent',
          numColor: 'var(--red-text)',
          labelColor: 'var(--red-text)',
        }
      : {
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          numColor: 'var(--text)',
          labelColor: 'var(--sub)',
        }
  return (
    <div
      className="stat-card"
      style={{
        background: styles.background,
        borderColor: styles.borderColor,
      }}
    >
      <div className="stat-num" style={{ color: styles.numColor }}>
        {value}
      </div>
      <div className="stat-label" style={{ color: styles.labelColor }}>
        {label}
      </div>
    </div>
  )
}


function EmptyState({
  search,
  filter,
  model,
}: {
  search: string
  filter: PartFilter
  model: string
}) {
  const filtered = !!(search || model || filter !== 'all')
  return (
    <div className="card">
      <div className="empty-state">
        <div className="empty-state-icon">
          <PartIconLg />
        </div>
        <div className="empty-state-title">
          {filtered ? 'No parts match your filters' : 'No parts yet'}
        </div>
        <div className="empty-state-msg">
          {filtered
            ? 'Try removing a filter or clearing your search.'
            : 'Add parts to your inventory to start tracking stock.'}
        </div>
        {filtered && (
          <Link href="/parts">
            <Btn variant="secondary" size="sm">
              Clear filters
            </Btn>
          </Link>
        )}
      </div>
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function PartIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function PartIconLg() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.07 7.07l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.07-7.07l4.24-4.24" />
    </svg>
  )
}