import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  name:        z.string().min(1).max(80).optional(),
  description: z.string().max(200).optional(),
  capacity:    z.number().int().min(0).optional(),
  isActive:    z.boolean().optional(),
  parentId:    z.string().nullable().optional(),
})

export const PATCH = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  await requireAuth('case:dispatch')
  const { id } = await (ctx as Ctx).params
  const { data, error } = await parseBody(req, updateSchema)
  if (error) return error

  const location = await prisma.warehouseLocation.findUnique({ where: { id } })
  if (!location) return apiError('Location not found', 404)

  if (data.parentId) {
    const parent = await prisma.warehouseLocation.findUnique({ where: { id: data.parentId } })
    if (!parent) return apiError('Parent zone not found', 404)
    if (parent.parentId) return apiError('Cannot nest more than two levels deep', 400)
  }

  const updated = await prisma.warehouseLocation.update({ where: { id }, data })
  return apiSuccess(updated)
})

export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  await requireAuth('case:dispatch')
  const { id } = await (ctx as Ctx).params

  const location = await prisma.warehouseLocation.findUnique({
    where:   { id },
    include: { _count: { select: { cases: true, children: true } } },
  })
  if (!location) return apiError('Location not found', 404)
  if (location._count.cases > 0) return apiError('Cannot delete a location with active cases', 400)
  if (location._count.children > 0) return apiError('Remove all racks first', 400)

  await prisma.warehouseLocation.delete({ where: { id } })
  return apiSuccess({ deleted: true })
})
