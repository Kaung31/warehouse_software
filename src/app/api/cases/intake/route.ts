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

  let scooter = await prisma.scooter.findUnique({
    where: { serialNumber: data.serialNumber.toUpperCase().trim() },
  })

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
  const initialStatus = 'AWAITING_INBOUND'

  const caseRecord = await prisma.$transaction(async (tx) => {
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

    if (!customerId) {
      const placeholder = await tx.customer.create({
        data: { name: `Unknown — ${data.serialNumber}`, postcode: 'UNKNOWN' },
      })
      customerId = placeholder.id
    }

    const newCase = await tx.repairOrder.create({
      data: {
        orderNumber,
        scooterId:         scooter!.id,
        customerId:        customerId!,
        mechanicId:        null,
        faultDescription:  data.faultDescription,
        internalNotes:     data.internalNotes,
        priority:          data.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
        status:            initialStatus as 'AWAITING_INBOUND',
        caseType:          data.caseType as 'WARRANTY' | 'BGRADE',
        customerPrepaid:   data.customerPrepaid,
        csPaymentNote:     data.csPaymentNote,
        warrantyConfirmed: data.warrantyConfirmed,
        source:            data.source,
      },
    })

    await tx.invoiceReference.create({
      data: {
        caseId:        newCase.id,
        invoiceNumber: data.invoiceNumber ?? null,
        paymentStatus: data.caseType === 'WARRANTY'
          ? (data.customerPrepaid ? 'PAID' : 'UNPAID')
          : 'WARRANTY_APPROVED',
        updatedById: user.id,
      },
    })

    await tx.caseStatusHistory.create({
      data: {
        caseId:      newCase.id,
        fromStatus:  null,
        toStatus:    initialStatus,
        changedById: user.id,
        reason:      data.caseType === 'BGRADE'
          ? 'B-grade case created by inbound'
          : 'CS created case — awaiting physical scooter arrival',
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
