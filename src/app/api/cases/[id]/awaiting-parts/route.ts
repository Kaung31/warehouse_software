import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({
  // What parts are being waited on — optional note
  partsNote: z.string().max(300).optional(),
})

// PUT — transitions IN_REPAIR → AWAITING_PARTS
//
// Phase A change (Step 7): also clears mechanicId so the case leaves the
// pausing mechanic's queue. When parts arrive and the case is moved back
// to WAITING_FOR_MECHANIC by the warehouse / parts-arrived flow, it'll
// reappear in the shared queue and any mechanic can claim it via
// /api/cases/[id]/claim. Cf. spec, Phase A § 5.
export const PUT = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, schema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)
  if (existing.status !== 'IN_REPAIR') return apiError('Case must be IN_REPAIR to mark awaiting parts', 400)

  await prisma.$transaction(async tx => {
    await tx.repairOrder.update({
      where: { id },
      data:  {
        status:     'AWAITING_PARTS' as never,
        mechanicId: null,
      },
    })
    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  'IN_REPAIR',
        toStatus:    'AWAITING_PARTS',
        changedById: user.id,
        reason:      data.partsNote ? `Awaiting parts: ${data.partsNote}` : 'Awaiting spare parts',
      },
    })
  })

  await logAudit({ userId: user.id, action: 'case.awaiting_parts', entityType: 'RepairOrder', entityId: id })

  await invalidateCaseCache(id)

  // Phase B — notify the customer we're waiting on parts.
  await enqueue('notify-status-change', { caseId: id, toStatus: 'AWAITING_PARTS' })
  await broadcastCaseUpdate({ caseId: id, toStatus: 'AWAITING_PARTS', role: 'MECHANIC', type: 'status_change' })

  return apiSuccess({ status: 'AWAITING_PARTS' })
})

// DELETE — transitions AWAITING_PARTS → IN_REPAIR (parts arrived, resuming)
export const DELETE = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id } = await (ctx as Ctx).params

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)
  if (existing.status !== 'AWAITING_PARTS') return apiError('Case must be AWAITING_PARTS to resume', 400)

  const now = new Date()

  await prisma.$transaction(async tx => {
    await tx.repairOrder.update({
      where: { id },
      data:  { status: 'IN_REPAIR', repairStartedAt: existing.repairStartedAt ?? now },
    })
    await tx.repairTimeLog.upsert({
      where:  { caseId: id },
      create: { caseId: id, mechanicId: user.id, startedAt: now },
      update: { startedAt: now, completedAt: null, durationMinutes: null },
    })
    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  'AWAITING_PARTS',
        toStatus:    'IN_REPAIR',
        changedById: user.id,
        reason:      'Parts arrived — resuming repair',
      },
    })
  })

  await logAudit({ userId: user.id, action: 'case.parts_arrived', entityType: 'RepairOrder', entityId: id })
  await invalidateCaseCache(id)
  return apiSuccess({ status: 'IN_REPAIR' })
})
