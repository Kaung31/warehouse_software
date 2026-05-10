import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { startOfDay } from 'date-fns'
import KanbanBoard from '@/components/cases/KanbanBoard'
import Btn from '@/components/ui/Btn'

/**
 * Dashboard — operational command center.
 *
 * v2 changes (April 2026):
 *   • Bento layout: dark hero "Currently in workshop" card with active
 *     mechanic avatar stack, then stat tiles in mixed sizes, then kanban.
 *   • All inline-style stats replaced with .stat-card / .bento classes.
 *   • Replaced 👋 emoji greeting with clean inline-SVG sun icon.
 *   • "+ New Case" becomes a real <Btn> with plus icon (not raw button).
 *   • New Prisma query: list of mechanics currently assigned to IN_REPAIR
 *     cases — drives the avatar stack on the hero card.
 *   • Stat cards render with .stat-card class, accent variant for active
 *     queue, danger variant for overdue/blocked counts.
 *   • Live-ticking time handled inside KanbanBoard (cards refresh).
 *   • Removed `caseType: WARRANTY` filter from kanban query — dashboard
 *     shows BOTH warranty + B-grade active cases (matches workflow).
 */

type IconName = 'sunrise' | 'sun' | 'moon' | 'plus' | 'trend-up' | 'trend-down'

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
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
    case 'sunrise':
      return (
        <svg {...p}>
          <path d="M17 18a5 5 0 0 0-10 0" />
          <line x1="12" y1="2" x2="12" y2="9" />
          <line x1="4.22" y1="10.22" x2="5.64" y2="11.64" />
          <line x1="1" y1="18" x2="3" y2="18" />
          <line x1="21" y1="18" x2="23" y2="18" />
          <line x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
          <line x1="23" y1="22" x2="1" y2="22" />
          <polyline points="8 6 12 2 16 6" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22" />
          <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
          <line x1="2" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="22" y2="12" />
          <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
          <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...p}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...p} strokeWidth={2}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )
    case 'trend-up':
      return (
        <svg {...p}>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      )
    case 'trend-down':
      return (
        <svg {...p}>
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
          <polyline points="17 18 23 18 23 12" />
        </svg>
      )
    default:
      return null
  }
}


export default async function DashboardPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })

  // Phase A — Mechanic experience.
  // Mechanics get a focused workspace at /workshop instead of the
  // operational command-center dashboard. Admin/manager/CS/warehouse
  // continue to land here.
  if (user?.role === 'MECHANIC') redirect('/workshop')

  if (!user) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '60vh',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 14, color: 'var(--sub)' }}>
          Setting up your account…
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          Contact your administrator to assign your role.
        </div>
      </div>
    )
  }

  const todayStart = startOfDay(new Date())
  const st = (s: string) => s as never

  /* ── Summary counts ──────────────────────────────────────────────── */
  const [
    receivedToday,
    dispatchedToday,
    awaitingCS,
    awaitingInbound,
    inRepair,
    awaitingParts,
    qcQueue,
    readyToShip,
    overdueRecharge,
    activeMechanics,
  ] = await Promise.all([
    prisma.repairOrder.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.repairOrder.count({
      where: { status: 'DISPATCHED', updatedAt: { gte: todayStart } },
    }),
    prisma.repairOrder.count({
      where: {
        status: { in: [st('AWAITING_CS'), st('CS_TRIAGE'), st('CS_RECHARGE')] },
      },
    }),
    prisma.repairOrder.count({
      where: {
        status: { in: [st('AWAITING_INBOUND'), st('INBOUND_DIAGNOSIS')] },
      },
    }),
    prisma.repairOrder.count({
      where: {
        status: { in: [st('IN_REPAIR'), st('WAITING_FOR_MECHANIC')] },
      },
    }),
    prisma.repairOrder.count({ where: { status: st('AWAITING_PARTS') } }),
    prisma.repairOrder.count({ where: { status: st('QUALITY_CONTROL') } }),
    prisma.repairOrder.count({ where: { status: 'READY_TO_SHIP' } }),
    prisma.repairOrder.count({ where: { status: st('CS_RECHARGE') } }),
    /* Active mechanics — those assigned to an IN_REPAIR case */
    prisma.user.findMany({
      where: {
        role: 'MECHANIC',
        repairOrders: {
          some: {
            status: { in: [st('IN_REPAIR'), st('AWAITING_PARTS')] },
          },
        },
      },
      select: { id: true, name: true },
      take: 8,
    }),
  ])

  /* ── Kanban data: all active cases ────────────────────────────────── */
  const activeCases = await prisma.repairOrder.findMany({
    where: {
      status: {
        notIn: [
          'DISPATCHED',
          'DELIVERED',
          'CANCELLED',
          'BGRADE_RECORDED',
        ] as never[],
      },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    include: {
      scooter: { select: { serialNumber: true, brand: true, model: true } },
      mechanic: { select: { name: true } },
      currentLocation: { select: { code: true } },
    },
  })

  const kanbanCases = activeCases.map(c => ({
    id: c.id,
    orderNumber: c.orderNumber,
    caseType: c.caseType,
    status: c.status,
    priority: c.priority,
    brand: (c.scooter as { brand: string }).brand,
    model: (c.scooter as { model: string }).model,
    fault: c.faultDescription ?? null,
    source: (c as { source?: string | null }).source ?? null,
    mechanic:
      (c as { mechanic?: { name: string } | null }).mechanic?.name ?? null,
    location:
      (c as { currentLocation?: { code: string } | null }).currentLocation
        ?.code ?? null,
    updatedAt: c.updatedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  }))

  const dateLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const hour = new Date().getHours()
  const greetingIcon: IconName =
    hour < 6 ? 'moon' : hour < 12 ? 'sunrise' : hour < 18 ? 'sun' : 'moon'
  const greetingText =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user.name?.split(' ')[0] ?? user.role

  return (
    <div
      className="fade-up"
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      {/* ── Page header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div>
          <div
            className="eyebrow"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--sub)',
              marginBottom: 4,
            }}
          >
            <Icon name={greetingIcon} size={13} />
            {greetingText}, {firstName}
          </div>
          <h1
            className="page-title"
            style={{ marginBottom: 2 }}
          >
            Today&apos;s workshop
          </h1>
          <div className="mono" style={{ fontSize: 12, color: 'var(--sub)' }}>
            {dateLabel}
          </div>
        </div>
        <Link href="/cases/new">
          <Btn variant="primary" iconLeft={<Icon name="plus" size={14} />}>
            New case
          </Btn>
        </Link>
      </div>

      {/* ── Bento: hero + stat tiles ── */}
      <div className="bento">
        {/* Hero card — currently in workshop */}
        <div
          className="bento-hero"
          style={{
            background:
              'linear-gradient(135deg, #042C53 0%, #0a3a6b 100%)',
            color: '#fff',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 22px',
            minHeight: 130,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--card-sh)',
          }}
        >
          <div>
            <div
              className="eyebrow"
              style={{ color: '#85B7EB', marginBottom: 6 }}
            >
              Currently in workshop
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}
              >
                {inRepair}
              </span>
              <span style={{ fontSize: 14, color: '#85B7EB' }}>
                {inRepair === 1 ? 'scooter being repaired' : 'scooters being repaired'}
              </span>
            </div>
            {awaitingParts > 0 && (
              <div style={{ fontSize: 12, color: '#85B7EB', marginTop: 6 }}>
                + {awaitingParts} awaiting parts
              </div>
            )}
          </div>

          {/* Mechanic avatar stack */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {activeMechanics.length > 0 ? (
              <>
                <div className="av-stack">
                  {activeMechanics.slice(0, 5).map(m => (
                    <div
                      key={m.id}
                      className="av av-md"
                      title={m.name ?? 'Mechanic'}
                      style={{
                        background: hashColor(m.name ?? m.id),
                        borderColor: '#042C53',
                      }}
                    >
                      {(m.name ?? '?')
                        .split(' ')
                        .map(w => w[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: '#85B7EB' }}>
                  {activeMechanics.length} mechanic
                  {activeMechanics.length === 1 ? '' : 's'} on shift
                </span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: '#85B7EB' }}>
                No mechanics currently assigned
              </span>
            )}
          </div>
        </div>

        {/* Inbound queue */}
        <StatTile
          label="Inbound queue"
          value={awaitingInbound}
          tone={awaitingInbound > 0 ? 'warn' : 'neutral'}
        />

        {/* Dispatched today */}
        <StatTile
          label="Dispatched today"
          value={dispatchedToday}
          tone={dispatchedToday > 0 ? 'good' : 'neutral'}
          trend={dispatchedToday > 0 ? 'up' : undefined}
        />
      </div>

      {/* ── Secondary stat row ── */}
      <div className="grid4">
        <StatTile label="CS queue" value={awaitingCS} small />
        <StatTile label="QC queue" value={qcQueue} small />
        <StatTile
          label="Awaiting parts"
          value={awaitingParts}
          tone={awaitingParts > 0 ? 'warn' : 'neutral'}
          small
        />
        <StatTile
          label="Recharge"
          value={overdueRecharge}
          tone={overdueRecharge > 0 ? 'danger' : 'neutral'}
          small
        />
      </div>

      {/* ── Kanban ── */}
      <div style={{ flex: 1, minHeight: 480 }}>
        <KanbanBoard cases={kanbanCases} />
      </div>

      {/* ── Footer hint ── */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: 'var(--text-faint)',
          marginTop: 4,
        }}
      >
        <span>{receivedToday} received today</span>
        <span>·</span>
        <span>{readyToShip} ready to ship</span>
      </div>
    </div>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function StatTile({
  label,
  value,
  tone,
  small,
  trend,
}: {
  label: string
  value: number
  tone?: 'neutral' | 'good' | 'warn' | 'danger'
  small?: boolean
  trend?: 'up' | 'down'
}) {
  const styles =
    tone === 'good'
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
        padding: small ? '14px 16px' : '18px 20px',
      }}
    >
      <div
        className="stat-num"
        style={{
          color: styles.numColor,
          fontSize: small ? 22 : 28,
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        {value}
        {trend && (
          <span
            style={{
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              opacity: 0.7,
            }}
          >
            <Icon name={trend === 'up' ? 'trend-up' : 'trend-down'} size={12} />
          </span>
        )}
      </div>
      <div
        className="stat-label"
        style={{ color: styles.labelColor }}
      >
        {label}
      </div>
    </div>
  )
}


/** Deterministic color from a string. Same as cases/page.tsx — kept local
 * for now; will be extracted into a shared util in a later phase. */
function hashColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
    hash |= 0
  }
  const palette = [
    '#1a5fff',
    '#7c3aed',
    '#0f766e',
    '#dc2626',
    '#c2410c',
    '#b45309',
    '#16a34a',
    '#4338ca',
    '#475569',
  ]
  return palette[Math.abs(hash) % palette.length]
}