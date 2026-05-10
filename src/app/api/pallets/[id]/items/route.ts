import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

const addSchema = z.object({
  repairOrderId: z.string(),
})

// POST — add a case to this pallet
export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:inbound_triage')
  const { id } = await (ctx as Ctx).params
  const { data, error } = await parseBody(req, addSchema)
  if (error) return error

  const pallet = await prisma.pallet.findUnique({
    where:   { id },
    include: { _count: { select: { items: { where: { removedAt: null } } } } },
  })
  if (!pallet)          return apiError('Pallet not found', 404)
  if (pallet.isSealed)  return apiError('Pallet is sealed — no more additions', 400)
  if (pallet._count.items >= pallet.capacity) return apiError(`Pallet is full (${pallet.capacity} max)`, 400)

  const ro = await prisma.repairOrder.findUnique({ where: { id: data.repairOrderId } })
  if (!ro) return apiError('Case not found', 404)

  // Remove from any existing pallet first
  await prisma.palletItem.updateMany({
    where:  { repairOrderId: data.repairOrderId, removedAt: null },
    data:   { removedAt: new Date() },
  })

  await prisma.palletItem.create({
    data: { palletId: id, repairOrderId: data.repairOrderId, addedById: user.id },
  })

  await prisma.repairOrder.update({
    where: { id: data.repairOrderId },
    data:  { currentPalletId: id },
  })

  return apiSuccess({ ok: true })
})

// DELETE — remove a case from pallet (?repairOrderId=xxx)
export const DELETE = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  await requireAuth('case:inbound_triage')
  const { id } = await (ctx as Ctx).params
  const repairOrderId = req.nextUrl.searchParams.get('repairOrderId')
  if (!repairOrderId) return apiError('repairOrderId required', 400)

  await prisma.palletItem.updateMany({
    where: { palletId: id, repairOrderId, removedAt: null },
    data:  { removedAt: new Date() },
  })

  await prisma.repairOrder.update({
    where: { id: repairOrderId },
    data:  { currentPalletId: null },
  })

  return apiSuccess({ ok: true })
})
