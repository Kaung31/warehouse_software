import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { mechanicNotesSchema } from '@/lib/schemas/task'

type Ctx = { params: Promise<{ id: string }> }

// PATCH /api/cases/[id]/mechanic-notes
//
// Used by the workshop's auto-save-on-blur notes textarea.
//
// Writes to RepairOrder.internalNotes (no schema change). The reason this
// is its own endpoint, rather than a generic case PATCH, is to keep the
// auth surface narrow: only the assigned mechanic + ADMIN/MANAGER can
// touch notes, and they can ONLY touch notes — not anything else on the
// case.
export const PATCH = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair') // ADMIN | MANAGER | MECHANIC
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, mechanicNotesSchema)
  if (error) return error

  const repair = await prisma.repairOrder.findUnique({
    where:  { id },
    select: { mechanicId: true },
  })
  if (!repair) return apiError('Case not found', 404)

  if (user.role === 'MECHANIC' && repair.mechanicId !== user.id) {
    return apiError('Only the assigned mechanic can edit notes on this case', 403)
  }

  await prisma.repairOrder.update({
    where: { id },
    data:  { internalNotes: data.notes ?? null },
  })

  await logAudit({
    userId:     user.id,
    action:     'case.notes_updated',
    entityType: 'RepairOrder',
    entityId:   id,
  })

  return apiSuccess({ id })
})
