import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const ZONE_TYPES = ['INBOUND_AREA', 'WARRANTY_RACK', 'BGRADE_AREA', 'MECHANIC_QUEUE', 'QC_RACK', 'DISPATCH_AREA', 'STORAGE', 'RACK'] as const

const createSchema = z.object({
  name:        z.string().min(1).max(80),
  code:        z.string().min(1).max(20).toUpperCase(),
  type:        z.enum(ZONE_TYPES),
  description: z.string().max(200).optional(),
  capacity:    z.number().int().min(0).optional(),
  parentId:    z.string().optional(),
})

const INACTIVE_STATUSES = ['DISPATCHED', 'CANCELLED'] as const

export const GET = withErrorHandler(async () => {
  await requireAuth()

  // Top-level zones with nested racks
  const zones = await prisma.warehouseLocation.findMany({
    where:   { parentId: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: { cases: { where: { status: { notIn: [...INACTIVE_STATUSES] } } } },
      },
      children: {
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { cases: { where: { status: { notIn: [...INACTIVE_STATUSES] } } } },
          },
        },
      },
    },
  })

  return apiSuccess(zones)
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  await requireAuth('case:dispatch')
  const { data, error } = await parseBody(req, createSchema)
  if (error) return error

  const existing = await prisma.warehouseLocation.findUnique({ where: { code: data.code } })
  if (existing) return apiError('Location code already exists', 409)

  if (data.parentId) {
    const parent = await prisma.warehouseLocation.findUnique({ where: { id: data.parentId } })
    if (!parent) return apiError('Parent zone not found', 404)
  }

  const location = await prisma.warehouseLocation.create({ data })
  return apiSuccess(location, 201)
})
