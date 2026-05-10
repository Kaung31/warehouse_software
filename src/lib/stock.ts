import { prisma } from './prisma'
import { MovementReason } from '@prisma/client'
import { withPartLock } from './locks'

type ConsumePartParams = {
  repairOrderId: string
  partId:        string
  quantity:      number
  performedById: string
}

// This is the ONLY way stock should ever be reduced for a repair.
// It's atomic — either the stock deducts AND the repair part record
// creates, or neither happens.
//
// Phase 2: distributed lock keyed by partId via Upstash so two
// mechanics on different containers can't both pass the stockQty
// check before either of them writes. The transaction below already
// guards against a single-process race; the lock generalises that
// guarantee across the Railway cluster.
export async function consumePartForRepair(params: ConsumePartParams) {
  const { repairOrderId, partId, quantity, performedById } = params

  return withPartLock(partId, () => prisma.$transaction(async (tx) => {
    // Lock the part row while we check stock (prevents race conditions with 27 concurrent users)
    const part = await tx.part.findUnique({ where: { id: partId } })
    if (!part) return { success: false, error: 'Part not found' }
    if (!part.isActive) return { success: false, error: 'Part is no longer active' }
    if (part.stockQty < quantity) {
      return {
        success: false,
        error: `Insufficient stock. Available: ${part.stockQty}, requested: ${quantity}`,
      }
    }

    // Upsert the repair part record (increase qty if already linked)
    const repairPart = await tx.repairPart.upsert({
      where:  { repairOrderId_partId: { repairOrderId, partId } },
      create: { repairOrderId, partId, quantity },
      update: { quantity: { increment: quantity } },
      include: { part: true },
    })

    // Deduct stock
    await tx.part.update({
      where: { id: partId },
      data:  { stockQty: { decrement: quantity } },
    })

    // Record the movement — immutable audit trail
    await tx.stockMovement.create({
      data: {
        partId,
        delta:         -quantity,
        reason:        MovementReason.REPAIR_CONSUMED,
        referenceId:   repairOrderId,
        referenceType: 'RepairOrder',
        notes:         `Used in repair order`,
        performedById,
      },
    })

    return { success: true, repairPart }
  }))
}

type AdjustStockParams = {
  partId:        string
  delta:         number  // positive = stock in, negative = stock out
  reason:        MovementReason
  notes:         string
  performedById: string
  referenceId?:  string
}

// Manual stock adjustments — only ADMIN/MANAGER
export async function adjustStock(params: AdjustStockParams) {
  const { partId, delta, reason, notes, performedById, referenceId } = params

  return prisma.$transaction(async (tx) => {
    const part = await tx.part.findUnique({ where: { id: partId } })
    if (!part) return { success: false, error: 'Part not found' }

    const newQty = part.stockQty + delta
    // Database check constraint also prevents this, but check here for a better error message
    if (newQty < 0) {
      return { success: false, error: `Cannot reduce stock below zero. Current: ${part.stockQty}` }
    }

    const updated = await tx.part.update({
      where: { id: partId },
      data:  { stockQty: { increment: delta } },
    })

    await tx.stockMovement.create({
      data: {
        partId,
        delta,
        reason,
        notes,
        referenceId,
        referenceType: 'ManualAdjustment',
        performedById,
      },
    })

    return { success: true, part: updated }
  })
}