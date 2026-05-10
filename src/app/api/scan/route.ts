import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireAuth()
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return apiError('Missing query parameter q', 400)

  // ── Pallet scan (PLT-...) ─────────────────────────────────────
  if (q.toUpperCase().startsWith('PLT-')) {
    const pallet = await prisma.pallet.findFirst({
      where:   { palletNumber: { equals: q, mode: 'insensitive' } },
      include: {
        createdBy: { select: { name: true } },
        items: {
          where:   { removedAt: null },
          include: {
            repairOrder: {
              include: {
                scooter:  { select: { serialNumber: true, brand: true, model: true } },
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    })
    if (!pallet) return apiError('Pallet not found', 404)
    return apiSuccess({ matchType: 'pallet' as const, pallet })
  }

  // ── Repair ticket scan (RO-...) or fallback ───────────────────
  const caseRecord = await prisma.repairOrder.findFirst({
    where: { orderNumber: { equals: q, mode: 'insensitive' } },
    include: {
      scooter:         { select: { serialNumber: true, brand: true, model: true } },
      customer:        { select: { name: true, phone: true } },
      mechanic:        { select: { name: true } },
      currentLocation: { select: { name: true, code: true, type: true } },
      currentPallet:   { select: { palletNumber: true, locationCode: true } },
    },
  })

  if (caseRecord) {
    return apiSuccess({
      matchType:        'orderNumber' as const,
      id:               caseRecord.id,
      orderNumber:      caseRecord.orderNumber,
      status:           caseRecord.status,
      barcodeAssigned:  caseRecord.barcodeAssigned,
      rackLocation:     caseRecord.rackLocation,
      faultDescription: caseRecord.faultDescription,
      scooter:          caseRecord.scooter,
      customer:         caseRecord.customer,
      mechanic:         caseRecord.mechanic,
      currentLocation:  caseRecord.currentLocation,
      currentPallet:    caseRecord.currentPallet,
    })
  }

  // ── Serial number fallback ────────────────────────────────────
  const scooter = await prisma.scooter.findFirst({
    where: { serialNumber: { equals: q, mode: 'insensitive' } },
    include: {
      repairOrders: {
        where:   { status: { notIn: ['DISPATCHED', 'CANCELLED'] } },
        orderBy: { createdAt: 'desc' },
        take:    1,
        include: {
          mechanic:        { select: { name: true } },
          currentLocation: { select: { name: true, code: true, type: true } },
          currentPallet:   { select: { palletNumber: true, locationCode: true } },
        },
      },
    },
  })

  if (scooter?.repairOrders[0]) {
    const ro = scooter.repairOrders[0]
    return apiSuccess({
      matchType:        'serialNumber' as const,
      id:               ro.id,
      orderNumber:      ro.orderNumber,
      status:           ro.status,
      barcodeAssigned:  ro.barcodeAssigned,
      rackLocation:     ro.rackLocation,
      faultDescription: ro.faultDescription,
      scooter:          { serialNumber: scooter.serialNumber, brand: scooter.brand, model: scooter.model },
      customer:         null,
      mechanic:         ro.mechanic,
      currentLocation:  ro.currentLocation,
      currentPallet:    ro.currentPallet,
    })
  }

  // ── Part barcode scan ─────────────────────────────────────────
  const part = await prisma.part.findFirst({
    where: {
      OR: [
        { barcode: { equals: q, mode: 'insensitive' } },
        { sku:     { equals: q, mode: 'insensitive' } },
      ],
    },
  })
  if (part) {
    return apiSuccess({
      matchType:         'part' as const,
      id:                part.id,
      name:              part.name,
      sku:               part.sku,
      barcode:           part.barcode,
      stockQty:          part.stockQty,
      warehouseLocation: part.warehouseLocation,
      compatibleModels:  part.compatibleModels,
      reorderLevel:      part.reorderLevel,
    })
  }

  return apiError('Nothing found — scan a repair ticket, pallet QR, or serial number', 404)
})
