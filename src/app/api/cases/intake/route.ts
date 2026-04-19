import { NextRequest } from 'next/server'
import { requireAuth, parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { intakeSchema } from '@/lib/schemas/case'
import { generateOrderNumber } from '@/lib/order-number'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

export const POST = withErrorHandler(async (req: NextRequest) => {
  const user = await requireAuth('case:intake')
  const { data, error } = await parseBody(req, intakeSchema)
  if (error) return error

  // --- Find or create scooter ---
  let scooter = await prisma.scooter.findUnique({
    where: { serialNumber: data.serialNumber.toUpperCase().trim() },
  })

  // --- Find or create customer ---
  let customerId: string | null = null
  if (data.customerName && data.customerPostcode) {
    let customer = await prisma.customer.findFirst({
      where: { name: data.customerName, postcode: data.customerPostcode.toUpperCase().trim(), isDeleted: false },
    })
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name:     data.customerName,
          postcode: data.customerPostcode.toUpperCase().trim(),
          phone:    data.customerPhone,
          email:    data.customerEmail,
        },
      })
    }
    customerId = customer.id
  }

  const orderNumber   = await generateOrderNumber()
  // WARRANTY cases start at AWAITING_INBOUND — CS creates the folder,
  // Inbound triages when the scooter physically arrives → then AWAITING_CS for payment gate.
  const initialStatus = data.caseType === 'WARRANTY' ? 'AWAITING_INBOUND' : 'BGRADE_RECORDED'

  const caseRecord = await prisma.$transaction(async (tx) => {
    // Create scooter if new
    if (!scooter) {
      scooter = await tx.scooter.create({
        data: {
          serialNumber: data.serialNumber.toUpperCase().trim(),
          brand:        data.brand,
          model:        data.model,
          status:       'IN_REPAIR',
          customerId:   customerId ?? undefined,
        },
      })
    } else {
      await tx.scooter.update({ where: { id: scooter.id }, data: { status: 'IN_REPAIR' } })
    }

    // If no customer yet, create a minimal placeholder
    if (!customerId) {
      const placeholder = await tx.customer.create({
        data: { name: `Unknown — ${data.serialNumber}`, postcode: 'UNKNOWN' },
      })
      customerId = placeholder.id
    }

    // Create the repair/case order
    const newCase = await tx.repairOrder.create({
      data: {
        orderNumber,
        scooterId:        scooter!.id,
        customerId:       customerId!,
        mechanicId:       null,
        faultDescription: data.faultDescription,
        internalNotes:    data.internalNotes,
        priority:         data.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
        status:           initialStatus as 'AWAITING_INBOUND' | 'BGRADE_RECORDED',
        caseType:         data.caseType as 'WARRANTY' | 'BGRADE',
      },
    })

    // Invoice reference (always create one — error codes added by Inbound later)
    await tx.invoiceReference.create({
      data: {
        caseId:        newCase.id,
        invoiceNumber: data.invoiceNumber ?? null,
        paymentStatus: data.caseType === 'WARRANTY' ? 'UNPAID' : 'WARRANTY_APPROVED',
        updatedById:   user.id,
      },
    })

    // Initial status history entry
    await tx.caseStatusHistory.create({
      data: {
        caseId:      newCase.id,
        fromStatus:  null,
        toStatus:    initialStatus,
        changedById: user.id,
        reason:      'CS created case — awaiting physical scooter arrival',
      },
    })

    return newCase
  })

  await logAudit({
    userId:     user.id,
    action:     'case.intake_created',
    entityType: 'RepairOrder',
    entityId:   caseRecord.id,
    newValue:   { orderNumber, caseType: data.caseType, status: initialStatus },
  })

  return apiSuccess({ id: caseRecord.id, orderNumber }, 201)
})
