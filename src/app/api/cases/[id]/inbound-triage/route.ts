import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { inboundTriageSchema, bgradeInboundSchema } from '@/lib/schemas/case'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { autoSetLocation } from '@/lib/autoLocation'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:inbound_triage')
  const { id } = await (ctx as Ctx).params

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)

  if (existing.status !== 'AWAITING_INBOUND') {
    return apiError(`Case is in status ${existing.status} — inbound triage only applies to AWAITING_INBOUND cases`, 400)
  }

  // BGRADE: simplified inbound, no error codes, skip CS
  if (existing.caseType === 'BGRADE') {
    const { data: bg, error: bgErr } = await parseBody(req, bgradeInboundSchema)
    if (bgErr) return bgErr

    await prisma.$transaction(async (tx) => {
      await tx.repairOrder.update({
        where: { id },
        data: {
          status:          'WAITING_FOR_MECHANIC',
          internalNotes:   bg.internalNotes ?? existing.internalNotes ?? undefined,
          barcodeAssigned: true,
          ...(bg.palletId ? { currentPalletId: bg.palletId } : {}),
        },
      })
      if (bg.palletId) {
        await tx.palletItem.upsert({
          where:  { palletId_repairOrderId: { palletId: bg.palletId, repairOrderId: id } },
          create: { palletId: bg.palletId, repairOrderId: id, addedById: user.id },
          update: { removedAt: null },
        })
      }
      await tx.caseStatusHistory.create({
        data: {
          caseId:      id,
          fromStatus:  'AWAITING_INBOUND',
          toStatus:    'WAITING_FOR_MECHANIC',
          changedById: user.id,
          reason:      'B-grade scooter received — assigned to mechanic queue',
        },
      })
    })
    await autoSetLocation(id, 'WAITING_FOR_MECHANIC')
    await invalidateCaseCache(id)
    return apiSuccess({ ok: true })
  }

  // WARRANTY: inbound manually decides routing
  const { data, error } = await parseBody(req, inboundTriageSchema)
  if (error) return error

  // Inbound explicitly decides: sendToMechanic=true skips the CS payment gate
  const toStatus = data.sendToMechanic ? 'WAITING_FOR_MECHANIC' : 'AWAITING_CS'

  await prisma.$transaction(async (tx) => {
    await tx.errorCodeReport.createMany({
      data: data.errorCodes.map((code) => ({
        caseId:    id,
        errorCode: code as 'E01',
      })),
    })

    await tx.repairOrder.update({
      where: { id },
      data: {
        status:          toStatus,
        diagnosis:       data.diagnosis,
        internalNotes:   data.internalNotes ?? existing.internalNotes ?? undefined,
        barcodeAssigned: true,
      },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  'AWAITING_INBOUND',
        toStatus,
        changedById: user.id,
        reason:      data.sendToMechanic
          ? 'Scooter received — inbound confirmed payment handled, sent to mechanic'
          : 'Scooter received by inbound — sent to CS for payment confirmation',
      },
    })
  })

  await autoSetLocation(id, toStatus)

  await logAudit({
    userId:     user.id,
    action:     'case.inbound_triage_completed',
    entityType: 'RepairOrder',
    entityId:   id,
    newValue:   { errorCodes: data.errorCodes, diagnosis: data.diagnosis, routedTo: toStatus },
  })

  await invalidateCaseCache(id)

  // Phase B — notify the customer their scooter has arrived. We always
  // fire INBOUND_DIAGNOSIS here regardless of whether the next status
  // is AWAITING_CS or WAITING_FOR_MECHANIC, since the workflow jumps
  // past the INBOUND_DIAGNOSIS enum value but the "arrived" milestone
  // is what matters to the customer. Best-effort, never throws.
  await enqueue('notify-status-change', { caseId: id, toStatus: 'INBOUND_DIAGNOSIS' })
  await broadcastCaseUpdate({ caseId: id, toStatus, role: 'WAREHOUSE', type: 'status_change' })

  return apiSuccess({ ok: true })
})
