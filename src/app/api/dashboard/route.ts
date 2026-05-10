import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { Role } from '@prisma/client'
import { subDays, startOfDay, startOfWeek, startOfMonth } from 'date-fns'
import { cached, dashboardKey } from '@/lib/cache'

/**
 * GET /api/dashboard
 *
 * Phase 2 — Upstash-backed cache. 5-minute TTL keyed per-role and
 * per-user; invalidated by any case-status mutation via
 * `invalidateCaseCache()` in `lib/cache.ts`.
 */
export const GET = withErrorHandler(async (_req: NextRequest) => {
  const user = await requireAuth('repair:view')

  const now          = new Date()
  const todayStart   = startOfDay(now)
  const weekStart    = startOfWeek(now, { weekStartsOn: 1 }) // Monday
  const monthStart   = startOfMonth(now)
  const last30Days   = subDays(now, 30)

  const key = dashboardKey({ role: user.role, endpoint: 'main', userId: user.id })

  // Every role gets their own tailored data
  if (user.role === Role.MECHANIC) {
    return apiSuccess(await cached(key, () => getMechanicDashboard(user.id, todayStart)))
  }

  if (user.role === Role.WAREHOUSE) {
    return apiSuccess(await cached(key, () => getWarehouseDashboard(todayStart)))
  }

  if (user.role === Role.CS) {
    return apiSuccess(await cached(key, () => getCSDashboard(todayStart, weekStart)))
  }

  // ADMIN and MANAGER get the full dashboard
  return apiSuccess(
    await cached(key, () => getManagerDashboard(todayStart, weekStart, monthStart, last30Days)),
  )
})

// ─── Mechanic view ───────────────────────────────────────────────────────────

async function getMechanicDashboard(mechanicId: string, todayStart: Date) {
  const [myActive, myToday, myByStatus] = await Promise.all([
    // All my active repairs
    prisma.repairOrder.findMany({
      where: {
        mechanicId,
        status: { notIn: ['DISPATCHED', 'CANCELLED'] },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        scooter:  { select: { serialNumber: true, model: true, brand: true } },
        customer: { select: { name: true, postcode: true } },
      },
    }),
    // How many I completed today
    prisma.repairOrder.count({
      where: { mechanicId, status: 'READY_TO_SHIP', updatedAt: { gte: todayStart } },
    }),
    // My repairs grouped by status
    prisma.repairOrder.groupBy({
      by:     ['status'],
      where:  { mechanicId, status: { notIn: ['DISPATCHED', 'CANCELLED'] } },
      _count: true,
    }),
  ])

  return {
    role:      'mechanic',
    myActive,
    myToday,
    myByStatus: myByStatus.map((s) => ({ status: s.status, count: s._count })),
  }
}

// ─── Warehouse view ──────────────────────────────────────────────────────────

async function getWarehouseDashboard(todayStart: Date) {
  const [
    readyToShip,
    lowStockParts,
    inboundToday,
    recentMovements,
  ] = await Promise.all([
    // Repairs ready to ship — warehouse needs to dispatch these
    prisma.repairOrder.findMany({
      where: { status: 'READY_TO_SHIP' },
      orderBy: { updatedAt: 'asc' },  // oldest first
      include: {
        customer: { select: { name: true, postcode: true, addressLine1: true, city: true } },
        scooter:  { select: { serialNumber: true, model: true } },
        shipments: { select: { trackingNumber: true, status: true } },
      },
    }),
    // Parts at or below reorder level
    prisma.part.findMany({
      where:   { isActive: true, stockQty: { lte: prisma.part.fields.reorderLevel } },
      orderBy: { stockQty: 'asc' },
      select:  {
        id: true, sku: true, name: true,
        stockQty: true, reorderLevel: true,
        warehouseLocation: true, supplierName: true,
      },
    }),
    // New repairs received today (inbound scooters)
    prisma.repairOrder.count({
      where: { status: 'RECEIVED', createdAt: { gte: todayStart } },
    }),
    // Recent stock movements (last 20)
    prisma.stockMovement.findMany({
      take:    20,
      orderBy: { createdAt: 'desc' },
      include: {
        part:        { select: { name: true, sku: true } },
        performedBy: { select: { name: true } },
      },
    }),
  ])

  return {
    role: 'warehouse',
    readyToShip,
    lowStockParts,
    lowStockCount: lowStockParts.length,
    inboundToday,
    recentMovements,
  }
}

// ─── CS view ─────────────────────────────────────────────────────────────────

async function getCSDashboard(todayStart: Date, weekStart: Date) {
  const [
    recentRepairs,
    dispatchedToday,
    pendingByStatus,
    newCustomersThisWeek,
  ] = await Promise.all([
    // Most recent repair orders — CS team tracks customer queries
    prisma.repairOrder.findMany({
      take:    30,
      orderBy: { updatedAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        scooter:  { select: { serialNumber: true, model: true } },
        shipments: { select: { trackingNumber: true, status: true } },
      },
    }),
    // Dispatched today — CS can tell customers their scooter is on its way
    prisma.repairOrder.count({
      where: { status: 'DISPATCHED', updatedAt: { gte: todayStart } },
    }),
    // Overview of repair queue
    prisma.repairOrder.groupBy({
      by:     ['status'],
      where:  { status: { notIn: ['DISPATCHED', 'CANCELLED'] } },
      _count: true,
    }),
    // New customers this week
    prisma.customer.count({
      where: { isDeleted: false, createdAt: { gte: weekStart } },
    }),
  ])

  return {
    role: 'cs',
    recentRepairs,
    dispatchedToday,
    pendingByStatus: pendingByStatus.map((s) => ({ status: s.status, count: s._count })),
    newCustomersThisWeek,
  }
}

// ─── Manager / Admin view ────────────────────────────────────────────────────

async function getManagerDashboard(
  todayStart: Date,
  weekStart:  Date,
  monthStart: Date,
  last30Days: Date,
) {
  const [
    // Today's numbers
    receivedToday,
    completedToday,
    dispatchedToday,

    // Queue overview
    repairsByStatus,
    repairsByPriority,

    // Mechanic performance this week
    mechanicPerformance,

    // Stock health
    totalParts,
    lowStockCount,

    // Revenue (second-hand sales this month)
    salesThisMonth,

    // 30-day repair trend (one record per day)
    repairTrend,

    // Unassigned repairs — need attention
    unassigned,
  ] = await Promise.all([
    prisma.repairOrder.count({ where: { createdAt: { gte: todayStart } } }),

    prisma.repairOrder.count({
      where: { status: 'READY_TO_SHIP', updatedAt: { gte: todayStart } },
    }),

    prisma.repairOrder.count({
      where: { status: 'DISPATCHED', updatedAt: { gte: todayStart } },
    }),

    prisma.repairOrder.groupBy({
      by:     ['status'],
      _count: true,
    }),

    prisma.repairOrder.groupBy({
      by:    ['priority'],
      where: { status: { notIn: ['DISPATCHED', 'CANCELLED'] } },
      _count: true,
    }),

    // Group completed repairs by mechanic this week
    prisma.repairOrder.groupBy({
      by:     ['mechanicId'],
      where:  { status: 'READY_TO_SHIP', updatedAt: { gte: weekStart } },
      _count: { _all: true },
      orderBy: { _count: { mechanicId: 'desc' } },
    }),

    prisma.part.count({ where: { isActive: true } }),

    prisma.part.count({
      where: { isActive: true, stockQty: { lte: prisma.part.fields.reorderLevel } },
    }),

    // Total second-hand revenue this month
    prisma.scooter.aggregate({
      where:   { status: 'SOLD', updatedAt: { gte: monthStart } },
      _sum:    { salePrice: true },
      _count:  true,
    }),

    // Raw repair counts per day for last 30 days
    // Using Prisma's groupBy on createdAt date
    prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT
        DATE("createdAt") as date,
        COUNT(*) as count
      FROM "RepairOrder"
      WHERE "createdAt" >= ${last30Days}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,

    prisma.repairOrder.count({
      where: {
        mechanicId: null,
        status:     { notIn: ['DISPATCHED', 'CANCELLED'] },
      },
    }),
  ])

  // Resolve mechanic names for the performance table
  const mechanicIds = mechanicPerformance
    .map((m) => m.mechanicId)
    .filter(Boolean) as string[]

  const mechanics = await prisma.user.findMany({
    where:  { id: { in: mechanicIds } },
    select: { id: true, name: true },
  })

  const mechanicMap = Object.fromEntries(mechanics.map((m) => [m.id, m.name]))

  return {
    role: 'manager',
    today: {
      received:   receivedToday,
      completed:  completedToday,
      dispatched: dispatchedToday,
    },
    queue: {
      byStatus:   repairsByStatus.map((s) => ({ status: s.status, count: s._count })),
      byPriority: repairsByPriority.map((p) => ({ priority: p.priority, count: p._count })),
      unassigned,
    },
    mechanicPerformance: mechanicPerformance.map((m) => ({
      mechanicId:   m.mechanicId,
      mechanicName: m.mechanicId ? mechanicMap[m.mechanicId] ?? 'Unknown' : 'Unassigned',
      completedThisWeek: m._count._all,
    })),
    stock: {
      totalParts,
      lowStockCount,
    },
    secondHand: {
      soldThisMonth:    salesThisMonth._count,
      revenueThisMonth: Number(salesThisMonth._sum.salePrice ?? 0),
    },
    repairTrend: repairTrend.map((r) => ({
      date:  r.date,
      count: Number(r.count),
    })),
  }
}