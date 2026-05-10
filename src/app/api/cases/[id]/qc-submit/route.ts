import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { qcSubmitSchema } from '@/lib/schemas/case'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { autoSetLocation } from '@/lib/autoLocation'
import { enqueue } from '@/lib/queue'
import { invalidateCaseCache } from '@/lib/cache'
import { broadcastCaseUpdate } from '@/lib/pusher'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:qc_submit')
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, qcSubmitSchema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)
  if (existing.status !== 'QUALITY_CONTROL') {
    return apiError(`Case must be in QUALITY_CONTROL status, currently ${existing.status}`, 400)
  }

  // Verify all templates provided are active
  const activeTemplates = await prisma.qCChecklistTemplate.findMany({
    where: { isActive: true },
    select: { id: true, stepNumber: true },
  })
  if (data.results.length !== activeTemplates.length) {
    return apiError(`Expected ${activeTemplates.length} QC steps, got ${data.results.length}`, 400)
  }

  const overallResult = data.results.every(r => r.result === 'PASS' || r.result === 'NA')
    ? 'PASS'
    : 'FAIL'

  const now = new Date()

  const submission = await prisma.$transaction(async (tx) => {
    const sub = await tx.qCSubmission.create({
      data: {
        caseId:        id,
        submittedById: user.id,
        overallResult: overallResult as 'PASS' | 'FAIL' | 'NA',
        submittedAt:   now,
      },
    })

    // Create individual results (immutable)
    await tx.qCChecklistResult.createMany({
      data: data.results.map((r) => ({
        caseId:       id,
        templateId:   r.templateId,
        submissionId: sub.id,
        result:       r.result as 'PASS' | 'FAIL' | 'NA',
        notes:        r.notes ?? null,
        photoS3Key:   r.photoS3Key ?? null,
        checkedById:  user.id,
      })),
    })

    // BGRADE cases go to BGRADE_RECORDED on pass (not READY_TO_SHIP)
    const isBgrade = existing.caseType === 'BGRADE'
    const newStatus = overallResult === 'PASS'
      ? (isBgrade ? 'BGRADE_RECORDED' : 'READY_TO_SHIP')
      : 'WAITING_FOR_MECHANIC'

    const repairUpdateData: Record<string, unknown> = {
      status:             newStatus,
      qcPassed:           overallResult === 'PASS',
      lastQCSubmissionId: sub.id,
    }

    // Assign to output pallet if provided (BGRADE QC pass)
    if (isBgrade && overallResult === 'PASS' && data.palletId) {
      repairUpdateData.currentPalletId = data.palletId
    }

    await tx.repairOrder.update({ where: { id }, data: repairUpdateData })

    // Create pallet item assignment for B-grade output pallet
    if (isBgrade && overallResult === 'PASS' && data.palletId) {
      await tx.palletItem.upsert({
        where: { palletId_repairOrderId: { palletId: data.palletId, repairOrderId: id } },
        create: { palletId: data.palletId, repairOrderId: id, addedById: user.id },
        update: { removedAt: null },
      })
    }

    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  'QUALITY_CONTROL',
        toStatus:    newStatus,
        changedById: user.id,
        reason:      overallResult === 'PASS'
          ? (isBgrade ? 'QC passed — B-grade recorded to pallet' : 'QC passed — ready to ship')
          : `QC failed — ${data.results.filter(r => r.result === 'FAIL').length} step(s) failed`,
      },
    })

    // If QC failed, add a comment listing the failed steps
    if (overallResult === 'FAIL') {
      const failedSteps = data.results
        .filter(r => r.result === 'FAIL')
        .map((r, i) => `• Step ${i + 1}${r.notes ? `: ${r.notes}` : ''}`)
        .join('\n')

      await tx.caseComment.create({
        data: {
          caseId:          id,
          authorId:        user.id,
          content:         `QC FAILED — the following steps did not pass:\n${failedSteps}\n\nCase returned to mechanic.`,
          isCustomerFacing: false,
        },
      })
    }

    return sub
  })

  const isBgradeCase = existing.caseType === 'BGRADE'
  const newStatus = submission.overallResult === 'PASS'
    ? (isBgradeCase ? 'BGRADE_RECORDED' : 'READY_TO_SHIP')
    : 'WAITING_FOR_MECHANIC'
  await autoSetLocation(id, newStatus)

  await logAudit({
    userId: user.id, action: 'case.qc_submitted',
    entityType: 'RepairOrder', entityId: id,
    newValue: { overallResult, submissionId: submission.id },
  })

  await invalidateCaseCache(id)

  // Phase B — notify the customer only when QC passes on a warranty
  // case. QC failures stay internal (the case loops back to mechanic),
  // and BGRADE cases have no customer.
  if (submission.overallResult === 'PASS' && !isBgradeCase) {
    await enqueue('notify-status-change', { caseId: id, toStatus: 'READY_TO_SHIP' })
  }
  await broadcastCaseUpdate({
    caseId:   id,
    toStatus: submission.overallResult === 'PASS'
      ? (isBgradeCase ? 'BGRADE_RECORDED' : 'READY_TO_SHIP')
      : 'WAITING_FOR_MECHANIC',
    role:     submission.overallResult === 'PASS' ? 'WAREHOUSE' : 'MECHANIC',
    type:     'status_change',
  })

  return apiSuccess({ overallResult, submissionId: submission.id })
})
