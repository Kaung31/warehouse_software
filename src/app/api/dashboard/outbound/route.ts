import { withErrorHandler, requireAuth, apiSuccess } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { startOfDay } from 'date-fns'
import { cached, dashboardKey } from '@/lib/cache'

export const GET = withErrorHandler(async () => {
  const user = await requireAuth('case:qc_submit')

  return apiSuccess(
    await cached(
      dashboardKey({ role: user.role, endpoint: 'outbound', userId: user.id }),
      async () => {
        const todayStart = startOfDay(new Date())

        const [qcPending, qcFailed, readyToShip, shippedToday] = await Promise.all([
          prisma.repairOrder.count({ where: { status: 'QUALITY_CONTROL' } }),
          prisma.repairOrder.count({ where: { status: 'QC_FAILED' } }),
          prisma.repairOrder.count({ where: { status: 'READY_TO_SHIP' } }),
          prisma.repairOrder.count({ where: { status: 'DISPATCHED', updatedAt: { gte: todayStart } } }),
        ])

        const queue = await prisma.repairOrder.findMany({
          where:   { status: { in: ['QUALITY_CONTROL', 'QC_FAILED', 'READY_TO_SHIP'] } },
          orderBy: [{ priority: 'desc' }, { updatedAt: 'asc' }],
          take:    20,
          include: {
            customer:     { select: { name: true } },
            scooter:      { select: { serialNumber: true, model: true } },
            mechanic:     { select: { name: true } },
            repairTimeLog: { select: { completedAt: true } },
            qcSubmissions: {
              orderBy: { submittedAt: 'desc' },
              take:    1,
              select:  { overallResult: true, submittedAt: true },
            },
          },
        })

        return { qcPending, qcFailed, readyToShip, shippedToday, queue }
      },
    ),
  )
})
