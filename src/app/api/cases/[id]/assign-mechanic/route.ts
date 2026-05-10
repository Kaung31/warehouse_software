import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  mechanicId: z.string().cuid(),
})

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, schema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)

  if (existing.status !== 'WAITING_FOR_MECHANIC') {
    return apiError(`Can only assign mechanic when status is WAITING_FOR_MECHANIC`, 400)
  }

  const mechanic = await prisma.user.findUnique({
    where:  { id: data.mechanicId, isActive: true },
    select: { id: true, name: true, role: true },
  })
  if (!mechanic || mechanic.role !== 'MECHANIC') {
    return apiError('Mechanic not found', 404)
  }

  await prisma.repairOrder.update({
    where: { id },
    data:  { mechanicId: data.mechanicId },
  })

  await logAudit({
    userId:     user.id,
    action:     'case.mechanic_assigned',
    entityType: 'RepairOrder',
    entityId:   id,
    newValue:   { mechanicId: data.mechanicId, mechanicName: mechanic.name },
  })

  return apiSuccess({ mechanicId: data.mechanicId, mechanicName: mechanic.name })
})
