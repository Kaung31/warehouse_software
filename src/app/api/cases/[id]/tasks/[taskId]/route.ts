import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { updateTaskSchema } from '@/lib/schemas/task'

type Ctx = { params: Promise<{ id: string; taskId: string }> }

// PATCH /api/cases/[id]/tasks/[taskId]
//
// Body fields are all optional (auto-save sends only what changed):
//   * title     — rename
//   * notes     — null clears notes
//   * completed — true: stamp completedAt + completedById,
//                 false: clear them
//   * order     — move to a new position; surrounding tasks reindex
//
// Restricted to the assigned mechanic + ADMIN/MANAGER.
export const PATCH = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id, taskId } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, updateTaskSchema)
  if (error) return error

  const task = await prisma.caseTask.findUnique({
    where:  { id: taskId },
    select: { id: true, caseId: true, order: true },
  })
  if (!task || task.caseId !== id) return apiError('Task not found', 404)

  const repair = await prisma.repairOrder.findUnique({
    where:  { id },
    select: { mechanicId: true },
  })
  if (!repair) return apiError('Case not found', 404)
  if (user.role === 'MECHANIC' && repair.mechanicId !== user.id) {
    return apiError('Only the assigned mechanic can edit tasks on this case', 403)
  }

  const updateData: Record<string, unknown> = {}
  if (data.title !== undefined) updateData.title = data.title
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.completed !== undefined) {
    updateData.completedAt   = data.completed ? new Date() : null
    updateData.completedById = data.completed ? user.id   : null
  }

  // Reorder logic: shift sibling tasks so the new ordering is contiguous.
  // We assume `order` is unique per case; if it isn't, this still produces
  // a deterministic ordering on the next read.
  const updated = await prisma.$transaction(async (tx) => {
    if (data.order !== undefined && data.order !== task.order) {
      const from = task.order
      const to   = data.order

      // Cap `to` at the current max so a client requesting "move past the end"
      // still produces sensible numbering.
      const last = await tx.caseTask.findFirst({
        where:   { caseId: id },
        orderBy: { order: 'desc' },
        select:  { order: true },
      })
      const maxOrder = last ? last.order : 0
      const target   = Math.min(to, maxOrder)

      if (target > from) {
        // moved down — pull siblings between (from, target] up by 1
        await tx.caseTask.updateMany({
          where: {
            caseId: id,
            id:     { not: taskId },
            order:  { gt: from, lte: target },
          },
          data: { order: { decrement: 1 } },
        })
      } else if (target < from) {
        // moved up — push siblings between [target, from) down by 1
        await tx.caseTask.updateMany({
          where: {
            caseId: id,
            id:     { not: taskId },
            order:  { gte: target, lt: from },
          },
          data: { order: { increment: 1 } },
        })
      }
      updateData.order = target
    }

    return tx.caseTask.update({
      where: { id: taskId },
      data:  updateData,
      include: {
        completedBy: { select: { id: true, name: true } },
      },
    })
  })

  await logAudit({
    userId:     user.id,
    action:     'case.task_updated',
    entityType: 'CaseTask',
    entityId:   taskId,
    newValue:   { ...data },
  })

  return apiSuccess({ task: updated })
})

// DELETE /api/cases/[id]/tasks/[taskId]
//
// Hard delete. Sibling tasks below the deleted one are shifted up by 1 so
// `order` stays contiguous.
//
// Restricted to the assigned mechanic + ADMIN/MANAGER.
export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id, taskId } = await (ctx as Ctx).params

  const task = await prisma.caseTask.findUnique({
    where:  { id: taskId },
    select: { id: true, caseId: true, order: true, title: true },
  })
  if (!task || task.caseId !== id) return apiError('Task not found', 404)

  const repair = await prisma.repairOrder.findUnique({
    where:  { id },
    select: { mechanicId: true },
  })
  if (!repair) return apiError('Case not found', 404)
  if (user.role === 'MECHANIC' && repair.mechanicId !== user.id) {
    return apiError('Only the assigned mechanic can edit tasks on this case', 403)
  }

  await prisma.$transaction(async (tx) => {
    await tx.caseTask.delete({ where: { id: taskId } })
    await tx.caseTask.updateMany({
      where: { caseId: id, order: { gt: task.order } },
      data:  { order: { decrement: 1 } },
    })
  })

  await logAudit({
    userId:     user.id,
    action:     'case.task_deleted',
    entityType: 'CaseTask',
    entityId:   taskId,
    oldValue:   { caseId: id, title: task.title, order: task.order },
  })

  return apiSuccess({ id: taskId })
})
