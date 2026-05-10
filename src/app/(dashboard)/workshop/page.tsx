import { redirect } from 'next/navigation'
import Link from 'next/link'
import { startOfDay, startOfWeek, startOfMonth } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { paymentInfoFromCase } from '@/lib/paymentInfo'
import WorkshopClient from '@/components/workshop/WorkshopClient'
import Btn from '@/components/ui/Btn'

/**
 * /workshop — the mechanic's home page.
 *
 * Replaces /dashboard for users with role MECHANIC. Designed to give
 * one mechanic one obvious next thing to do.
 *
 * Layout (top to bottom):
 *   1. Header — greeting + page title + "Quick scan" button
 *   2. 4 stat tiles — available to claim, finished today, this week, this month
 *   3. Active job card (only when the mechanic has IN_REPAIR work)
 *   4. Available queue (claimable WAITING_FOR_MECHANIC cases)
 *
 * Server component does the data fetching; the interactive bits
 * (live timer, claim button, pause inline form) live in WorkshopClient.
 */

// Status families used by the page.
//
// We use `as never[]` casts because the Prisma RepairStatus enum is wider than
// the values we list here, and Prisma's `in:` typing complains otherwise.
const FINISHED_BY_MECHANIC: readonly string[] = [
  'QUALITY_CONTROL', // mechanic sent to QC
  'READY_TO_SHIP',   // QC passed
  'DISPATCHED',
  'DELIVERED',
  'BGRADE_RECORDED',
]

const ACTIVE_FOR_MECHANIC: readonly string[] = [
  'IN_REPAIR',
  // AWAITING_PARTS is hidden from the mechanic queue per spec — not "active"
  // for them either; once they pause for parts, mechanicId is cleared and
  // it leaves their workspace until the queue picks it up again.
]

export default async function WorkshopPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  // Non-mechanics shouldn't really be here — bounce them to the regular
  // dashboard. Admins/managers might still want to see this view though,
  // so allow them through (useful for testing the mechanic experience).
  if (user.role !== 'MECHANIC' && user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    redirect('/dashboard')
  }

  const now = new Date()
  const todayStart = startOfDay(now)
  const weekStart  = startOfWeek(now, { weekStartsOn: 1 })
  const monthStart = startOfMonth(now)

  /* ── Counts ───────────────────────────────────────────────────────── */
  const [
    availableCount,
    finishedToday,
    finishedThisWeek,
    finishedThisMonth,
  ] = await Promise.all([
    prisma.repairOrder.count({
      where: {
        status:     'WAITING_FOR_MECHANIC',
        mechanicId: null,
      },
    }),
    prisma.repairOrder.count({
      where: {
        mechanicId: user.id,
        status:     { in: FINISHED_BY_MECHANIC as never[] },
        updatedAt:  { gte: todayStart },
      },
    }),
    prisma.repairOrder.count({
      where: {
        mechanicId: user.id,
        status:     { in: FINISHED_BY_MECHANIC as never[] },
        updatedAt:  { gte: weekStart },
      },
    }),
    prisma.repairOrder.count({
      where: {
        mechanicId: user.id,
        status:     { in: FINISHED_BY_MECHANIC as never[] },
        updatedAt:  { gte: monthStart },
      },
    }),
  ])

  /* ── Active job (mechanic's own IN_REPAIR case) ──────────────────── */
  const activeRaw = await prisma.repairOrder.findFirst({
    where: {
      mechanicId: user.id,
      status:     { in: ACTIVE_FOR_MECHANIC as never[] },
    },
    include: {
      scooter:  { select: { brand: true, model: true, serialNumber: true } },
      customer: { select: { name: true } },
      invoice:  true,
    },
    orderBy: { repairStartedAt: 'desc' },
  })

  /* ── Available queue (FIFO with priority lift) ───────────────────── */
  const queueRaw = await prisma.repairOrder.findMany({
    where: {
      status:     'WAITING_FOR_MECHANIC',
      mechanicId: null,
    },
    orderBy: [
      { priority:  'desc' },
      { createdAt: 'asc' },
    ],
    take: 30,
    include: {
      scooter:         { select: { brand: true, model: true, serialNumber: true } },
      currentLocation: { select: { code: true, name: true } },
    },
  })

  /* ── My in-flight cases — sent to CS / paused for parts ──────────── */
  // After a mechanic recharges or pauses for parts, the case leaves the
  // active card. We still want them to be able to track those cases
  // without hunting through /cases.
  const inFlightRaw = await prisma.repairOrder.findMany({
    where: {
      mechanicId: user.id,
      status:     {
        in: ['AWAITING_CS', 'CS_RECHARGE', 'AWAITING_PARTS'] as never[],
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    include: {
      scooter:         { select: { brand: true, model: true, serialNumber: true } },
      currentLocation: { select: { code: true, name: true } },
    },
  })

  /* ── Serialise to plain JSON (Decimals → Number, Dates → ISO) ────── */
  const activeJob = activeRaw
    ? {
        id:              activeRaw.id,
        orderNumber:     activeRaw.orderNumber,
        caseType:        activeRaw.caseType,
        status:          activeRaw.status,
        scooter: {
          brand:        activeRaw.scooter.brand,
          model:        activeRaw.scooter.model,
          serialNumber: activeRaw.scooter.serialNumber,
        },
        customerName:    activeRaw.customer?.name ?? null,
        faultDescription: activeRaw.faultDescription,
        repairStartedAt: activeRaw.repairStartedAt?.toISOString() ?? null,
        createdAt:       activeRaw.createdAt.toISOString(),
        rechargeReason:  activeRaw.rechargeReason,
        customerApprovedAt: activeRaw.customerApprovedAt?.toISOString() ?? null,
        payment: paymentInfoFromCase({
          customerPrepaid:    activeRaw.customerPrepaid,
          csPaymentNote:      activeRaw.csPaymentNote,
          warrantyConfirmed:  activeRaw.warrantyConfirmed,
          quoteAmount:        activeRaw.quoteAmount,
          quotedAt:           activeRaw.quotedAt,
          quoteApprovedAt:    activeRaw.quoteApprovedAt,
          rechargeAmount:     activeRaw.rechargeAmount,
          rechargeReason:     activeRaw.rechargeReason,
          customerApprovedAt: activeRaw.customerApprovedAt,
          invoice:            activeRaw.invoice,
        }),
      }
    : null

  const queue = queueRaw.map((c) => ({
    id:           c.id,
    orderNumber:  c.orderNumber,
    caseType:     c.caseType,
    priority:     c.priority,
    scooter: {
      brand:        c.scooter.brand,
      model:        c.scooter.model,
      serialNumber: c.scooter.serialNumber,
    },
    faultDescription: c.faultDescription,
    createdAt:        c.createdAt.toISOString(),
    locationLabel:
      c.rackLocation
      ?? c.currentLocation?.code
      ?? c.currentLocation?.name
      ?? null,
  }))

  const inFlight = inFlightRaw.map((c) => ({
    id:           c.id,
    orderNumber:  c.orderNumber,
    caseType:     c.caseType,
    status:       c.status,
    scooter: {
      brand:        c.scooter.brand,
      model:        c.scooter.model,
      serialNumber: c.scooter.serialNumber,
    },
    locationLabel:
      c.rackLocation
      ?? c.currentLocation?.code
      ?? c.currentLocation?.name
      ?? null,
    rechargeReason:     c.rechargeReason,
    customerApprovedAt: c.customerApprovedAt?.toISOString() ?? null,
    updatedAt:          c.updatedAt.toISOString(),
  }))

  /* ── Greeting ────────────────────────────────────────────────────── */
  const hour = now.getHours()
  const greetingText =
    hour < 12 ? 'Good morning'
      : hour < 17 ? 'Good afternoon'
      : 'Good evening'
  const firstName = user.name?.split(' ')[0] ?? 'there'

  return (
    <div
      className="fade-up"
      style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1100 }}
    >
      {/* ── Page header ───────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ color: 'var(--sub)', marginBottom: 4 }}>
            {greetingText}, {firstName}
          </div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            Today&apos;s workshop
          </h1>
        </div>
        <Link href="/repair-guides">
          <Btn variant="secondary" iconLeft={<BookIcon />}>
            Browse repair guides
          </Btn>
        </Link>
      </div>

      {/* ── Stat tiles ────────────────────────────────────────────── */}
      <div className="grid4">
        <StatTile
          label="Available to claim"
          value={availableCount}
          tone={availableCount > 0 ? 'accent' : 'neutral'}
        />
        <StatTile
          label="Finished today"
          value={finishedToday}
          tone={finishedToday > 0 ? 'good' : 'neutral'}
        />
        <StatTile label="This week"  value={finishedThisWeek} />
        <StatTile label="This month" value={finishedThisMonth} />
      </div>

      {/* ── Active job + queue + in-flight + banners (client) ─────── */}
      <WorkshopClient
        activeJob={activeJob}
        queue={queue}
        inFlight={inFlight}
        currentUserName={user.name ?? ''}
        busyQueueThreshold={10}
      />
    </div>
  )
}

/* ─── Sub-components (server-rendered) ───────────────────────────────── */

function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'good' | 'accent'
}) {
  const styles =
    tone === 'good'
      ? {
          background:  'var(--green-bg)',
          borderColor: 'transparent',
          numColor:    'var(--green-text)',
          labelColor:  'var(--green-text)',
        }
      : tone === 'accent' && value > 0
      ? {
          background:  'var(--accent-dim)',
          borderColor: 'transparent',
          numColor:    'var(--accent-text)',
          labelColor:  'var(--accent-text)',
        }
      : {
          background:  'var(--surface)',
          borderColor: 'var(--border)',
          numColor:    'var(--text)',
          labelColor:  'var(--sub)',
        }
  return (
    <div
      className="stat-card"
      style={{
        background:  styles.background,
        borderColor: styles.borderColor,
        padding:     '16px 18px',
      }}
    >
      <div className="stat-num"   style={{ color: styles.numColor, fontSize: 26 }}>
        {value}
      </div>
      <div className="stat-label" style={{ color: styles.labelColor }}>
        {label}
      </div>
    </div>
  )
}

function BookIcon() {
  return (
    <svg
      width={14} height={14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}
