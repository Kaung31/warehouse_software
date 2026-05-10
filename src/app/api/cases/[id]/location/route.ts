import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

// Either field is optional — clients send only what they want to set.
//   * locationId   → sets RepairOrder.currentLocationId (FK to WarehouseLocation)
//   * rackLocation → sets RepairOrder.rackLocation (freeform "MECH-HOLD-3")
//
// At least one must be present (otherwise the call is a no-op).
const schema = z
  .object({
    locationId:   z.string().nullable().optional(),
    rackLocation: z.string().max(100).nullable().optional(),
  })
  .refine(
    (d) => d.locationId !== undefined || d.rackLocation !== undefined,
    { message: 'Provide locationId or rackLocation' },
  )

export const PUT = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:view')
  const { id } = await (ctx as Ctx).params
  const { data, error } = await parseBody(req, schema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)

  if (data.locationId) {
    const loc = await prisma.warehouseLocation.findUnique({ where: { id: data.locationId } })
    if (!loc) return apiError('Location not found', 404)
    if (!loc.isActive) return apiError('Location is inactive', 400)
  }

  // Build the patch — only fields the client explicitly sent get touched.
  const patch: { currentLocationId?: string | null; rackLocation?: string | null } = {}
  if (data.locationId   !== undefined) patch.currentLocationId = data.locationId
  if (data.rackLocation !== undefined) patch.rackLocation      = data.rackLocation

  const updated = await prisma.repairOrder.update({
    where: { id },
    data:  patch,
    include: { currentLocation: { select: { name: true, code: true } } },
  })

  await logAudit({ userId: user.id, action: 'case.location_updated', entityType: 'RepairOrder', entityId: id })
  return apiSuccess({
    currentLocation: updated.currentLocation,
    rackLocation:    updated.rackLocation,
  })
})
