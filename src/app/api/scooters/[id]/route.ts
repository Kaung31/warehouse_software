import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { updateScooterSchema } from '@/lib/schemas/scooter'
import { getViewUrl } from '@/lib/r2'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  await requireAuth('scooter:view')
  const { id } = await (ctx as Ctx).params

  const [scooter, rawPhotos] = await Promise.all([
    prisma.scooter.findUnique({
      where: { id },
      include: {
        customer: true,
        repairOrders: {
          orderBy: { createdAt: 'desc' },
          include: {
            mechanic:    { select: { id: true, name: true } },
            repairParts: { include: { part: { select: { name: true, sku: true } } } },
          },
        },
      },
    }),
    prisma.photo.findMany({
      where: { entityType: 'Scooter', entityId: id },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  if (!scooter) return apiError('Scooter not found', 404)

  const photosWithUrls = await Promise.all(
    rawPhotos.map(async (p: typeof rawPhotos[number]) => ({
      ...p,
      viewUrl: await getViewUrl(p.s3Key),
    }))
  )

  return apiSuccess({ ...scooter, photos: photosWithUrls })
})

export const PUT = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('scooter:update')
  const { id } = await (ctx as Ctx).params

  const existing = await prisma.scooter.findUnique({ where: { id } })
  if (!existing) return apiError('Scooter not found', 404)

  const { data, error } = await parseBody(req, updateScooterSchema)
  if (error) return error

  const updated = await prisma.scooter.update({ where: { id }, data })

  await logAudit({
    userId:     user.id,
    action:     'scooter.updated',
    entityType: 'Scooter',
    entityId:   id,
    oldValue:   { status: existing.status, grade: existing.grade },
    newValue:   { status: updated.status,  grade: updated.grade  },
  })

  return apiSuccess(updated)
})

// DELETE — removes a scooter only if it has no active (non-cancelled/dispatched) repair orders
export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('scooter:update')
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return apiError('Only admins and managers can delete scooters', 403)
  }

  const { id } = await (ctx as Ctx).params
  const scooter = await prisma.scooter.findUnique({ where: { id }, select: { id: true, serialNumber: true } })
  if (!scooter) return apiError('Scooter not found', 404)

  const activeOrders = await prisma.repairOrder.count({
    where: { scooterId: id, status: { notIn: ['CANCELLED', 'DISPATCHED'] } },
  })
  if (activeOrders > 0) {
    return apiError(`Cannot delete — scooter has ${activeOrders} active repair order(s)`, 400)
  }

  await prisma.scooter.delete({ where: { id } })
  await logAudit({ userId: user.id, action: 'scooter.deleted', entityType: 'Scooter', entityId: id, oldValue: { serialNumber: scooter.serialNumber } })
  return apiSuccess({ deleted: true })
})