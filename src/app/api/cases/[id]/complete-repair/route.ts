import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { completeRepairSchema } from '@/lib/schemas/case'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { autoSetLocation } from '@/lib/autoLocation'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:start_repair')
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, completeRepairSchema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({
    where: { id },
    include: { repairTimeLog: true },
  })
  if (!existing) return apiError('Case not found', 404)
  if (existing.status !== 'IN_REPAIR') return apiError('Case is not currently in repair', 400)

  if (user.role === 'MECHANIC' && existing.mechanicId !== user.id) {
    return apiError('Not assigned to you', 403)
  }

  const now           = new Date()
  const startedAt     = existing.repairTimeLog?.startedAt ?? existing.repairStartedAt ?? now
  const durationMs    = now.getTime() - startedAt.getTime()
  const durationMins  = Math.round(durationMs / 60000)

  await prisma.$transaction(async (tx) => {
    await tx.repairOrder.update({
      where: { id },
      data: {
        status:               'QUALITY_CONTROL',
        repairCompletedAt:    now,
        repairDurationMinutes: durationMins,
        diagnosis:            data.diagnosis,
        resolution:           data.resolution,
        internalNotes:        data.repairNotes ?? existing.internalNotes,
      },
    })

    // BGRADE: save mechanic grading to scooter record
    if (data.colour !== undefined || data.totalMileage !== undefined || data.grade !== undefined) {
      const scooterUpdate: Record<string, unknown> = {}
      if (data.colour       !== undefined) scooterUpdate.colour       = data.colour
      if (data.totalMileage !== undefined) scooterUpdate.totalMileage = data.totalMileage
      if (data.grade        !== undefined) scooterUpdate.grade        = data.grade as 'A' | 'B' | 'C'
      await tx.scooter.update({ where: { id: existing.scooterId }, data: scooterUpdate })
    }

    await tx.repairTimeLog.upsert({
      where:  { caseId: id },
      create: { caseId: id, mechanicId: user.id, startedAt, completedAt: now, durationMinutes: durationMins },
      update: { completedAt: now, durationMinutes: durationMins },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  'IN_REPAIR',
        toStatus:    'QUALITY_CONTROL',
        changedById: user.id,
        reason:      'Repair completed — moved to QC',
      },
    })
  })

  await autoSetLocation(id, 'QUALITY_CONTROL')

  await logAudit({
    userId: user.id, action: 'case.repair_completed',
    entityType: 'RepairOrder', entityId: id,
    newValue: { completedAt: now.toISOString(), durationMins },
  })

  return apiSuccess({ completedAt: now, durationMins })
})
