import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generatePalletNumber } from '@/lib/pallet-number'

const createSchema = z.object({
  purpose:     z.enum(['BGRADE', 'HOLDING']).default('BGRADE'),
  capacity:    z.number().int().min(1).max(50).default(10),
  locationCode:z.string().max(40).optional(),
  notes:       z.string().max(300).optional(),
})

export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireAuth()
  const purpose  = req.nextUrl.searchParams.get('purpose') ?? undefined
  const sealedQp = req.nextUrl.searchParams.get('isSealed')
  const isSealed = sealedQp === 'true' ? true : sealedQp === 'false' ? false : undefined
  const where: Record<string, unknown> = {}
  if (purpose)             where.purpose  = purpose
  if (isSealed !== undefined) where.isSealed = isSealed
  const pallets = await prisma.pallet.findMany({
    where:   Object.keys(where).length > 0 ? where : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { name: true } },
      _count:    { select: { items: { where: { removedAt: null } } } },
    },
  })
  return apiSuccess(pallets)
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  const user = await requireAuth('case:inbound_triage')
  const { data, error } = await parseBody(req, createSchema)
  if (error) return error

  const palletNumber = await generatePalletNumber()
  const pallet = await prisma.pallet.create({
    data: {
      palletNumber,
      purpose:      data.purpose,
      capacity:     data.capacity,
      locationCode: data.locationCode,
      notes:        data.notes,
      createdById:  user.id,
    },
  })
  return apiSuccess(pallet, 201)
})
