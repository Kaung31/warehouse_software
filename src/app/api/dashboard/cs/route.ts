import { withErrorHandler, requireAuth, apiSuccess } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { startOfDay } from 'date-fns'
import { cached, dashboardKey } from '@/lib/cache'

export const GET = withErrorHandler(async () => {
  const user = await requireAuth('case:cs_update')

  return apiSuccess(
    await cached(
      dashboardKey({ role: user.role, endpoint: 'cs', userId: user.id }),
      async () => {
        const todayStart = startOfDay(new Date())

        const [awaitingReview, paymentPending, disputed, approvedToday] = await Promise.all([
          prisma.repairOrder.count({ where: { status: 'AWAITING_CS' } }),
          prisma.repairOrder.count({
            where: { invoice: { paymentStatus: 'UNPAID' }, status: { not: 'DISPATCHED' } },
          }),
          prisma.repairOrder.count({ where: { status: 'DISPUTED' } }),
          prisma.repairOrder.count({
            where: { status: 'WAITING_FOR_MECHANIC', updatedAt: { gte: todayStart } },
          }),
        ])

        const queue = await prisma.repairOrder.findMany({
          where:   { status: { in: ['AWAITING_CS', 'DISPUTED'] } },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
          take:    20,
          include: {
            customer:   { select: { name: true, postcode: true } },
            scooter:    { select: { serialNumber: true, model: true } },
            invoice:    { select: { paymentStatus: true, invoiceNumber: true } },
            errorCodes: { select: { errorCode: true } },
          },
        })

        return { awaitingReview, paymentPending, disputed, approvedToday, queue }
      },
    ),
  )
})
