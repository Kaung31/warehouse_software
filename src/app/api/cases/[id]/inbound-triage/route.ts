import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { inboundTriageSchema } from '@/lib/schemas/case'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/cases/[id]/inbound-triage
// Stage 2: Inbound team scans the arrived scooter, assigns error codes + diagnosis.
// Transitions AWAITING_INBOUND → AWAITING_CS (payment gate for CS).
export const POST = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const user = await requireAuth('case:inbound_triage')
  const { id } = await (ctx as Ctx).params

  const { data, error } = await parseBody(req, inboundTriageSchema)
  if (error) return error

  const existing = await prisma.repairOrder.findUnique({ where: { id } })
  if (!existing) return apiError('Case not found', 404)

  if (existing.status !== 'AWAITING_INBOUND') {
    return apiError(`Case is in status ${existing.status} — inbound triage only applies to AWAITING_INBOUND cases`, 400)
  }

  await prisma.$transaction(async (tx) => {
    // Add error codes reported by inbound
    await tx.errorCodeReport.createMany({
      data: data.errorCodes.map((code) => ({
        caseId:    id,
        errorCode: code as 'E01',
      })),
    })

    // Store inbound's technical diagnosis in the diagnosis field
    await tx.repairOrder.update({
      where: { id },
      data: {
        status:       'AWAITING_CS',
        diagnosis:    data.diagnosis,
        internalNotes: data.internalNotes ?? existing.internalNotes ?? undefined,
      },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId:      id,
        fromStatus:  'AWAITING_INBOUND',
        toStatus:    'AWAITING_CS',
        changedById: user.id,
        reason:      'Scooter received by inbound — awaiting CS payment confirmation',
      },
    })
  })

  await logAudit({
    userId:     user.id,
    action:     'case.inbound_triage_completed',
    entityType: 'RepairOrder',
    entityId:   id,
    newValue:   { errorCodes: data.errorCodes, diagnosis: data.diagnosis },
  })

  return apiSuccess({ ok: true })
})
