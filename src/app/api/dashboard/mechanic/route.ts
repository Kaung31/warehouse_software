import { NextRequest } from 'next/server'
import { withErrorHandler, requireAuth, apiSuccess } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { cached, dashboardKey } from '@/lib/cache'

export const GET = withErrorHandler(async (_req: NextRequest) => {
  const user = await requireAuth('case:start_repair')

  return apiSuccess(
    await cached(
      dashboardKey({ role: user.role, endpoint: 'mechanic', userId: user.id }),
      async () => {
        const [assignedToMe, unassigned, urgent, returnedFromQC] = await Promise.all([
          prisma.repairOrder.count({
            where: { mechanicId: user.id, status: { in: ['WAITING_FOR_MECHANIC', 'IN_REPAIR', 'QC_FAILED'] } },
          }),
          prisma.repairOrder.count({
            where: { mechanicId: null, status: 'WAITING_FOR_MECHANIC' },
          }),
          prisma.repairOrder.count({
            where: { priority: 'URGENT', status: { in: ['WAITING_FOR_MECHANIC', 'IN_REPAIR'] } },
          }),
          prisma.repairOrder.count({ where: { status: 'QC_FAILED' } }),
        ])

        const myQueue = await prisma.repairOrder.findMany({
          where: {
            status: { in: ['WAITING_FOR_MECHANIC', 'IN_REPAIR', 'QC_FAILED'] },
            OR: [{ mechanicId: user.id }, { mechanicId: null }],
          },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
          take:    20,
          include: {
            customer:     { select: { name: true } },
            scooter:      { select: { serialNumber: true, model: true } },
            repairTimeLog: { select: { startedAt: true } },
            errorCodes:   { select: { errorCode: true } },
          },
        })

        return { assignedToMe, unassigned, urgent, returnedFromQC, myQueue }
      },
    ),
  )
})
