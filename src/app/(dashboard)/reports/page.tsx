import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import StatusBadge from '@/components/ui/StatusBadge'
import { subDays, startOfDay, startOfMonth } from 'date-fns'

/**
 * Reports page — operational analytics for ADMIN / MANAGER roles.
 *
 * v2 changes (April 2026):
 *   • Date-range selector at the top (7d / 30d / 90d / month / all)
 *     via ?range= query param. Default 30d.
 *   • Stats strip uses .grid4 + .stat-card classes (consistent with
 *     dashboard / cases / parts pages).
 *   • Section labels use .eyebrow class.
 *   • Two NEW reports added per spec:
 *       - SLA compliance: % of cases dispatched within target time
 *         (target: 5 days from creation to dispatch)
 *       - Dispute rate: % of cases that hit DISPUTED or QC_FAILED
 *   • Repair queue, mechanic performance, top parts, low stock layouts
 *     redesigned to use the new pill-and-bar visual language.
 *   • Daily intake chart: proper SVG with axis labels, peak day
 *     highlighted, mono count labels, day-of-week labels below.
 *   • All emojis (📊 ✓) replaced with inline SVG icons.
 *   • Prisma low-stock bug fix — same pattern as the parts page,
 *     uses $queryRaw for the column-vs-column comparison.
 *
 * Future: per-card CSV export via /api/reports/[type]/csv (stubs in
 * place; backend endpoints to follow).
 */

type Range = '7d' | '30d' | '90d' | 'month' | 'all'

const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
  all: 'All time',
}

/** Cases dispatched within this many days are "on time". */
const SLA_TARGET_DAYS = 5

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user || !['ADMIN', 'MANAGER'].includes(user.role)) {
    redirect('/dashboard')
  }

  const sp = await searchParams
  const rawRange = sp.range as Range | undefined
  const range: Range =
    rawRange && ['7d', '30d', '90d', 'month', 'all'].includes(rawRange)
      ? rawRange
      : '30d'

  const today = startOfDay(new Date())
  const monthStart = startOfMonth(new Date())

  /** Effective `since` based on selected range. `null` = all time. */
  const since: Date | null =
    range === '7d'
      ? subDays(today, 7)
      : range === '30d'
      ? subDays(today, 30)
      : range === '90d'
      ? subDays(today, 90)
      : range === 'month'
      ? monthStart
      : null

  const last7Days = subDays(today, 7)

  /* ─── Parallel queries ────────────────────────────────────────────── */
  const sinceDispatchedFilter = since
    ? { updatedAt: { gte: since } }
    : {}
  const sinceCreatedFilter = since
    ? { createdAt: { gte: since } }
    : {}

  const [
    repairsByStatus,
    completedInRange,
    avgResolutionRaw,
    onTimeCountRaw,
    disputedCountRaw,
    totalInRange,
    mechanicStats,
    lowStockParts,
    topParts,
    secondHandRevenue,
    dailyLast7,
  ] = await Promise.all([
    /* 1. Active queue breakdown */
    prisma.repairOrder.groupBy({ by: ['status'], _count: true }),

    /* 2. Completed (dispatched) in range */
    prisma.repairOrder.count({
      where: { status: 'DISPATCHED', ...sinceDispatchedFilter },
    }),

    /* 3. Average resolution time (received → dispatched) */
    since
      ? prisma.$queryRaw<{ avg_hours: number }[]>`
          SELECT AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 3600) as avg_hours
          FROM "RepairOrder"
          WHERE status = 'DISPATCHED' AND "closedAt" IS NOT NULL AND "createdAt" >= ${since}
        `
      : prisma.$queryRaw<{ avg_hours: number }[]>`
          SELECT AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 3600) as avg_hours
          FROM "RepairOrder"
          WHERE status = 'DISPATCHED' AND "closedAt" IS NOT NULL
        `,

    /* 4. SLA compliance: dispatched within SLA_TARGET_DAYS */
    since
      ? prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count FROM "RepairOrder"
          WHERE status = 'DISPATCHED' AND "closedAt" IS NOT NULL
          AND "createdAt" >= ${since}
          AND EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400 <= ${SLA_TARGET_DAYS}
        `
      : prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count FROM "RepairOrder"
          WHERE status = 'DISPATCHED' AND "closedAt" IS NOT NULL
          AND EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400 <= ${SLA_TARGET_DAYS}
        `,

    /* 5. Disputed / QC-failed count (dispute rate numerator) */
    prisma.repairOrder.count({
      where: {
        status: { in: ['DISPUTED', 'QC_FAILED'] as never[] },
        ...sinceCreatedFilter,
      },
    }),

    /* 6. Total cases in range (dispute rate denominator) */
    prisma.repairOrder.count({
      where: { ...sinceCreatedFilter },
    }),

    /* 7. Mechanic performance */
    prisma.repairOrder.groupBy({
      by: ['mechanicId'],
      where: { status: 'DISPATCHED', ...sinceDispatchedFilter },
      _count: { _all: true },
      orderBy: { _count: { mechanicId: 'desc' } },
      take: 8,
    }),

    /* 8. Low-stock parts — fixed query (column-vs-column comparison) */
    prisma.$queryRaw<
      {
        id: string
        name: string
        sku: string
        stockQty: number
        reorderLevel: number
        supplierName: string | null
      }[]
    >`
      SELECT id, name, sku, "stockQty", "reorderLevel", "supplierName"
      FROM "Part"
      WHERE "isActive" = true AND "stockQty" <= "reorderLevel"
      ORDER BY "stockQty" ASC
      LIMIT 10
    `,

    /* 9. Top consumed parts in range */
    since
      ? prisma.$queryRaw<{ name: string; sku: string; total: bigint }[]>`
          SELECT p.name, p.sku, ABS(SUM(sm.delta)) as total
          FROM "StockMovement" sm
          JOIN "Part" p ON p.id = sm."partId"
          WHERE sm.reason = 'REPAIR_CONSUMED' AND sm."createdAt" >= ${since}
          GROUP BY p.name, p.sku
          ORDER BY total DESC LIMIT 8
        `
      : prisma.$queryRaw<{ name: string; sku: string; total: bigint }[]>`
          SELECT p.name, p.sku, ABS(SUM(sm.delta)) as total
          FROM "StockMovement" sm
          JOIN "Part" p ON p.id = sm."partId"
          WHERE sm.reason = 'REPAIR_CONSUMED'
          GROUP BY p.name, p.sku
          ORDER BY total DESC LIMIT 8
        `,

    /* 10. 2nd-hand revenue this month (always month, not range) */
    prisma.scooter.aggregate({
      where: { status: 'SOLD', updatedAt: { gte: monthStart } },
      _sum: { salePrice: true },
      _count: true,
    }),

    /* 11. Daily intake last 7 days (always 7d, not range) */
    prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE("createdAt") as date, COUNT(*) as count
      FROM "RepairOrder"
      WHERE "createdAt" >= ${last7Days}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,
  ])

  /* ─── Resolve mechanic names ──────────────────────────────────────── */
  const mechanicIds = mechanicStats
    .map(m => m.mechanicId)
    .filter(Boolean) as string[]
  const mechanics = await prisma.user.findMany({
    where: { id: { in: mechanicIds } },
    select: { id: true, name: true },
  })
  const mechanicMap = Object.fromEntries(mechanics.map(m => [m.id, m.name]))

  /* ─── Derived metrics ─────────────────────────────────────────────── */
  const activeRepairs = repairsByStatus
    .filter(
      r =>
        !['DISPATCHED', 'CANCELLED', 'BGRADE_RECORDED', 'DELIVERED'].includes(
          r.status
        )
    )
    .reduce((sum, r) => sum + r._count, 0)

  const avgHours = Math.round(avgResolutionRaw[0]?.avg_hours ?? 0)
  const onTimeCount = Number(onTimeCountRaw[0]?.count ?? 0)
  const slaPercent =
    completedInRange > 0
      ? Math.round((onTimeCount / completedInRange) * 100)
      : 0
  const disputedCount = Number(disputedCountRaw)
  const disputeRate =
    totalInRange > 0
      ? Math.round((disputedCount / totalInRange) * 1000) / 10
      : 0
  const secondHandRevenueValue = Number(
    secondHandRevenue._sum.salePrice ?? 0
  )

  const totalLast7 = dailyLast7.reduce((sum, d) => sum + Number(d.count), 0)

  return (
    <div className="fade-up">
      <PageHeader title="Reports" sub={RANGE_LABELS[range]} />

      {/* ── Date range selector ── */}
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
          Range
        </span>
        {(['7d', '30d', '90d', 'month', 'all'] as Range[]).map(r => (
          <Link key={r} href={r === '30d' ? '/reports' : `/reports?range=${r}`}>
            <span
              className={`filter-pill${range === r ? ' on' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {RANGE_LABELS[r]}
            </span>
          </Link>
        ))}
      </div>

      {/* ── Stats strip ── */}
      <div className="grid4" style={{ marginBottom: 18 }}>
        <StatTile
          label="Active repairs"
          value={String(activeRepairs)}
          tone="accent"
        />
        <StatTile
          label="Completed"
          value={String(completedInRange)}
          sub={RANGE_LABELS[range].toLowerCase()}
        />
        <StatTile
          label="Avg resolution"
          value={`${avgHours}h`}
          sub="received → dispatched"
        />
        <StatTile
          label="SLA on-time"
          value={`${slaPercent}%`}
          sub={`${SLA_TARGET_DAYS}-day target`}
          tone={
            completedInRange === 0
              ? 'neutral'
              : slaPercent >= 90
              ? 'good'
              : slaPercent >= 75
              ? 'warn'
              : 'danger'
          }
        />
      </div>

      {/* ── Secondary stats ── */}
      <div className="grid4" style={{ marginBottom: 18 }}>
        <StatTile
          label="Dispute rate"
          value={`${disputeRate.toFixed(1)}%`}
          sub={`${disputedCount} of ${totalInRange} cases`}
          tone={
            totalInRange === 0
              ? 'neutral'
              : disputeRate <= 5
              ? 'good'
              : disputeRate <= 10
              ? 'warn'
              : 'danger'
          }
          small
        />
        <StatTile
          label="Last 7 days intake"
          value={String(totalLast7)}
          small
        />
        <StatTile
          label="Low stock parts"
          value={String(lowStockParts.length)}
          tone={lowStockParts.length > 0 ? 'warn' : 'neutral'}
          small
        />
        <StatTile
          label="2nd-hand revenue"
          value={`£${secondHandRevenueValue.toLocaleString()}`}
          sub={`${secondHandRevenue._count} sold this month`}
          small
        />
      </div>

      {/* ── 2-col grid of report cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          marginBottom: 14,
        }}
      >
        {/* Repair queue by status */}
        <ReportCard
          title="Repair queue by status"
          subtitle={`${activeRepairs} active`}
          exportType="queue"
        >
          {repairsByStatus.length === 0 ? (
            <Empty>No active cases</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {repairsByStatus
                .sort((a, b) => b._count - a._count)
                .map((r, i, arr) => (
                  <div
                    key={r.status}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 18px',
                      borderBottom:
                        i < arr.length - 1
                          ? '1px solid var(--border)'
                          : 'none',
                    }}
                  >
                    <StatusBadge status={r.status} />
                    <span
                      className="mono"
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'var(--text)',
                      }}
                    >
                      {r._count}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </ReportCard>

        {/* Mechanic performance */}
        <ReportCard
          title="Mechanic performance"
          subtitle={`Completed in ${RANGE_LABELS[range].toLowerCase()}`}
          exportType="mechanics"
        >
          {mechanicStats.length === 0 ? (
            <Empty>No completed repairs in this period</Empty>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {mechanicStats.map((m, i) => {
                const name = m.mechanicId
                  ? mechanicMap[m.mechanicId] ?? 'Unknown'
                  : 'Unassigned'
                const max = mechanicStats[0]._count._all || 1
                const pct = Math.round((m._count._all / max) * 100)
                return (
                  <div
                    key={m.mechanicId ?? 'unassigned'}
                    style={{
                      padding: '8px 18px',
                      borderBottom:
                        i < mechanicStats.length - 1
                          ? '1px solid var(--border)'
                          : 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 5,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        {i === 0 && (
                          <span
                            className="badge badge-pass"
                            style={{
                              fontSize: 9,
                              padding: '1px 6px',
                              fontWeight: 500,
                            }}
                          >
                            Top
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 13,
                            color: 'var(--text)',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {name}
                        </span>
                      </div>
                      <span
                        className="mono"
                        style={{ fontSize: 13, fontWeight: 600 }}
                      >
                        {m._count._all}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: 'var(--dim)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background:
                            i === 0 ? 'var(--accent)' : 'var(--accent-dim)',
                          borderRadius: 2,
                          transition: 'width 0.4s',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ReportCard>

        {/* Low stock */}
        <ReportCard
          title={`Low stock parts (${lowStockParts.length})`}
          subtitle="Below reorder level"
          exportType="low-stock"
        >
          {lowStockParts.length === 0 ? (
            <div
              style={{
                padding: '20px 18px',
                color: 'var(--green-text)',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name="check" size={14} />
              All parts adequately stocked
            </div>
          ) : (
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th>Part</th>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>Stock</th>
                  <th style={{ textAlign: 'right' }}>Reorder</th>
                </tr>
              </thead>
              <tbody>
                {lowStockParts.map(p => {
                  const isOut = p.stockQty <= 0
                  return (
                    <tr
                      key={p.id}
                      style={{
                        background: isOut
                          ? 'var(--red-bg)'
                          : 'var(--amber-bg)',
                      }}
                    >
                      <td style={{ fontWeight: 500, fontSize: 12 }}>
                        {p.name}
                      </td>
                      <td>
                        <span className="mono">{p.sku}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span
                          className="mono"
                          style={{
                            color: isOut
                              ? 'var(--red-text)'
                              : 'var(--amber-text)',
                            fontWeight: 600,
                          }}
                        >
                          {p.stockQty}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span
                          className="mono"
                          style={{ color: 'var(--text-faint)' }}
                        >
                          {p.reorderLevel}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </ReportCard>

        {/* Top consumed parts */}
        <ReportCard
          title="Most-used parts"
          subtitle={`Consumed in ${RANGE_LABELS[range].toLowerCase()}`}
          exportType="parts"
        >
          {topParts.length === 0 ? (
            <Empty>No part usage data yet</Empty>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {topParts.map((p, i) => {
                const max = Number(topParts[0].total) || 1
                const pct = Math.round((Number(p.total) / max) * 100)
                return (
                  <div
                    key={p.sku}
                    style={{
                      padding: '8px 18px',
                      borderBottom:
                        i < topParts.length - 1
                          ? '1px solid var(--border)'
                          : 'none',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--text-faint)',
                            background: 'var(--s2)',
                            padding: '1px 5px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          #{i + 1}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--text)',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </span>
                      </div>
                      <span
                        className="mono"
                        style={{ fontSize: 12, fontWeight: 600 }}
                      >
                        {Number(p.total)}×
                      </span>
                    </div>
                    <div
                      style={{
                        height: 3,
                        background: 'var(--dim)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background:
                            i < 3 ? 'var(--accent)' : 'var(--accent-dim)',
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ReportCard>
      </div>

      {/* ── Daily intake chart (full-width) ── */}
      <ReportCard
        title="Daily repair intake"
        subtitle="Last 7 days"
        exportType="daily-intake"
      >
        {dailyLast7.length === 0 ? (
          <Empty>No data in the last 7 days</Empty>
        ) : (
          <DailyIntakeChart days={dailyLast7} />
        )}
      </ReportCard>
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function ReportCard({
  title,
  subtitle,
  children,
  exportType,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  exportType?: string
}) {
  return (
    <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
      <div
        style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-faint)',
                marginTop: 2,
                textTransform: 'none',
                letterSpacing: 0,
                fontWeight: 400,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {exportType && (
          <button
            type="button"
            className="btn-icon"
            title="Export to CSV (coming soon)"
            aria-label="Export to CSV"
            disabled
            style={{
              opacity: 0.5,
              cursor: 'not-allowed',
              flexShrink: 0,
            }}
          >
            <Icon name="download" size={13} />
          </button>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}


function StatTile({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'danger'
  small?: boolean
}) {
  const styles =
    tone === 'accent'
      ? {
          background: 'var(--accent-dim)',
          borderColor: 'transparent',
          numColor: 'var(--accent-text)',
          labelColor: 'var(--accent-text)',
        }
      : tone === 'good'
      ? {
          background: 'var(--green-bg)',
          borderColor: 'transparent',
          numColor: 'var(--green-text)',
          labelColor: 'var(--green-text)',
        }
      : tone === 'warn'
      ? {
          background: 'var(--amber-bg)',
          borderColor: 'transparent',
          numColor: 'var(--amber-text)',
          labelColor: 'var(--amber-text)',
        }
      : tone === 'danger'
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
        padding: small ? '14px 16px' : '18px 20px',
      }}
    >
      <div
        className="stat-num"
        style={{
          color: styles.numColor,
          fontSize: small ? 22 : 28,
        }}
      >
        {value}
      </div>
      <div className="stat-label" style={{ color: styles.labelColor }}>
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 10,
            color: styles.labelColor,
            opacity: 0.7,
            marginTop: 4,
            fontWeight: 400,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}


function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '20px 18px',
        color: 'var(--text-faint)',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  )
}


function DailyIntakeChart({
  days,
}: {
  days: { date: string; count: bigint }[]
}) {
  const max = Math.max(...days.map(d => Number(d.count)), 1)
  const peakIndex = days.reduce(
    (peak, d, i) =>
      Number(d.count) > Number(days[peak].count) ? i : peak,
    0
  )

  return (
    <div style={{ padding: '20px 18px' }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
          height: 140,
        }}
      >
        {days.map((d, i) => {
          const count = Number(d.count)
          const pct = Math.round((count / max) * 100)
          const isPeak = i === peakIndex && count > 0
          // Format date manually (avoids hydration mismatch)
          const dateObj = new Date(d.date)
          const dayLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
            dateObj.getDay()
          ]
          const dayNum = dateObj.getDate()
          return (
            <div
              key={String(d.date)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                height: '100%',
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: isPeak ? 'var(--accent-text)' : 'var(--sub)',
                  fontWeight: isPeak ? 600 : 500,
                }}
              >
                {count}
              </span>
              <div
                style={{
                  flex: 1,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-end',
                }}
              >
                <div
                  title={`${dayLabel} ${dayNum}: ${count} case${
                    count === 1 ? '' : 's'
                  }`}
                  style={{
                    width: '100%',
                    height: count > 0 ? `${Math.max(pct, 6)}%` : '4px',
                    background: isPeak
                      ? 'var(--accent)'
                      : 'var(--accent-dim)',
                    borderRadius: '4px 4px 0 0',
                    minHeight: 4,
                    transition: 'height 0.3s, background 0.3s',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-faint)',
                  whiteSpace: 'nowrap',
                  fontWeight: isPeak ? 600 : 400,
                }}
              >
                {dayLabel} {dayNum}
              </span>
            </div>
          )
        })}
      </div>
      {peakIndex >= 0 && Number(days[peakIndex]?.count ?? 0) > 0 && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--sub)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: 'var(--accent)',
              display: 'inline-block',
            }}
          />
          Peak: {Number(days[peakIndex].count)} case
          {Number(days[peakIndex].count) === 1 ? '' : 's'} on{' '}
          {(() => {
            const d = new Date(days[peakIndex].date)
            return `${
              ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
            } ${d.getDate()}`
          })()}
        </div>
      )}
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName = 'check' | 'download'

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'check':
      return (
        <svg {...p} strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'download':
      return (
        <svg {...p}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      )
    default:
      return null
  }
}