import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  locationCode: z.string().max(40).optional(),
  notes:        z.string().max(300).optional(),
  isSealed:     z.boolean().optional(),
})

export const GET = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  await requireAuth()
  const { id } = await (ctx as Ctx).params

  const pallet = await prisma.pallet.findUnique({
    where:   { id },
    include: {
      createdBy: { select: { name: true, role: true } },
      items: {
        where:   { removedAt: null },
        include: {
          repairOrder: {
            include: {
              scooter:  { select: { serialNumber: true, brand: true, model: true } },
              customer: { select: { name: true } },
              mechanic: { select: { name: true } },
            },
          },
          addedBy: { select: { name: true } },
        },
        orderBy: { addedAt: 'desc' },
      },
    },
  })

  if (!pallet) return apiError('Pallet not found', 404)
  return apiSuccess(pallet)
})

export const PATCH = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  await requireAuth('case:inbound_triage')
  const { id } = await (ctx as Ctx).params
  const { data, error } = await parseBody(req, updateSchema)
  if (error) return error

  const pallet = await prisma.pallet.findUnique({ where: { id } })
  if (!pallet) return apiError('Pallet not found', 404)

  const updated = await prisma.pallet.update({ where: { id }, data })
  return apiSuccess(updated)
})
