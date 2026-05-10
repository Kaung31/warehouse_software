import { withErrorHandler, requireAuth, apiSuccess } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { startOfDay } from 'date-fns'
import { cached, dashboardKey } from '@/lib/cache'

export const GET = withErrorHandler(async () => {
  const user = await requireAuth('case:intake')

  return apiSuccess(
    await cached(
      dashboardKey({ role: user.role, endpoint: 'inbound', userId: user.id }),
      async () => {
        const todayStart = startOfDay(new Date())

        const [newToday, awaitingCS, missingInvoice, bgradeToday] = await Promise.all([
          prisma.repairOrder.count({ where: { createdAt: { gte: todayStart } } }),
          prisma.repairOrder.count({ where: { status: 'AWAITING_CS' } }),
          prisma.repairOrder.count({
            where: {
              status: { in: ['AWAITING_CS', 'WAITING_FOR_MECHANIC'] },
              invoice: { invoiceNumber: null },
            },
          }),
          prisma.repairOrder.count({
            where: { caseType: 'BGRADE', createdAt: { gte: todayStart } },
          }),
        ])

        const recent = await prisma.repairOrder.findMany({
          where:   { createdAt: { gte: todayStart } },
          orderBy: { createdAt: 'desc' },
          take:    10,
          include: {
            customer:   { select: { name: true, postcode: true } },
            scooter:    { select: { serialNumber: true, model: true } },
            errorCodes: { select: { errorCode: true } },
          },
        })

        return { newToday, awaitingCS, missingInvoice, bgradeToday, recent }
      },
    ),
  )
})
