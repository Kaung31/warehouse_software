import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { createTaskSchema } from '@/lib/schemas/task'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/cases/[id]/tasks
//
// Returns the case's tasks ordered by `order` ASC.
//
// Read access is broader than write access — ADMIN, MANAGER, the assigned
// mechanic, and CS can all view (CS gets a read-only view).
// WAREHOUSE is not granted task visibility (their stages don't depend on it).
export const GET = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:view')
  const { id } = await (ctx as Ctx).params

  const repair = await prisma.repairOrder.findUnique({
    where:  { id },
    select: { id: true, mechanicId: true },
  })
  if (!repair) return apiError('Case not found', 404)

  const allowed =
    user.role === 'ADMIN' ||
    user.role === 'MANAGER' ||
    user.role === 'CS' ||
    (user.role === 'MECHANIC' && repair.mechanicId === user.id)
  if (!allowed) return apiError('You do not have permission to view tasks on this case', 403)

  const tasks = await prisma.caseTask.findMany({
    where:   { caseId: id },
    orderBy: { order: 'asc' },
    include: {
      completedBy: { select: { id: true, name: true } },
    },
  })

  return apiSuccess({ tasks })
})

// POST /api/cases/[id]/tasks
//
// Creates a new task at the bottom of the list.
// Restricted to the assigned mechanic + ADMIN/MANAGER.
export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair') // ADMIN | MANAGER | MECHANIC
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, createTaskSchema)
  if (error) return error

  const repair = await prisma.repairOrder.findUnique({
    where:  { id },
    select: { id: true, mechanicId: true },
  })
  if (!repair) return apiError('Case not found', 404)

  // Only the assigned mechanic (or admin/manager) can mutate tasks.
  if (user.role === 'MECHANIC' && repair.mechanicId !== user.id) {
    return apiError('Only the assigned mechanic can edit tasks on this case', 403)
  }

  // Auto-assign next `order` value (max + 1, or 0 for empty list).
  const last = await prisma.caseTask.findFirst({
    where:   { caseId: id },
    orderBy: { order: 'desc' },
    select:  { order: true },
  })
  const nextOrder = last ? last.order + 1 : 0

  const task = await prisma.caseTask.create({
    data: {
      caseId: id,
      order:  nextOrder,
      title:  data.title,
      notes:  data.notes,
    },
    include: {
      completedBy: { select: { id: true, name: true } },
    },
  })

  await logAudit({
    userId:     user.id,
    action:     'case.task_created',
    entityType: 'CaseTask',
    entityId:   task.id,
    newValue:   { caseId: id, title: task.title, order: task.order },
  })

  return apiSuccess({ task }, 201)
})
