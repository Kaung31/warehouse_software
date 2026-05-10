import { z } from 'zod'
import { RepairStatus, Priority } from '@prisma/client'

export const createRepairSchema = z.object({
  scooterId:        z.string().cuid(),
  customerId:       z.string().cuid(),
  faultDescription: z.string().min(5).max(2000),
  priority:         z.nativeEnum(Priority).default('NORMAL'),
  mechanicId:       z.string().cuid().optional(),
  estimatedCost:    z.number().positive().optional(),
  internalNotes:    z.string().max(1000).optional(),
})

export const updateRepairSchema = z.object({
  faultDescription: z.string().min(5).max(2000).optional(),
  diagnosis:        z.string().max(2000).optional(),
  resolution:       z.string().max(2000).optional(),
  mechanicId:       z.string().cuid().nullable().optional(),
  priority:         z.nativeEnum(Priority).optional(),
  estimatedCost:    z.number().positive().optional(),
  finalCost:        z.number().positive().optional(),
  internalNotes:    z.string().max(1000).optional(),
})

// Valid status transitions — mechanics cannot skip steps
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  // Legacy flow
  RECEIVED:             ['DIAGNOSING', 'CANCELLED'],
  DIAGNOSING:           ['AWAITING_PARTS', 'IN_REPAIR', 'CANCELLED'],
  AWAITING_PARTS:       ['IN_REPAIR', 'CANCELLED'],
  IN_REPAIR:            ['QUALITY_CHECK', 'CANCELLED'],
  QUALITY_CHECK:        ['READY_TO_SHIP', 'IN_REPAIR'],
  READY_TO_SHIP:        ['DISPATCHED'],
  DISPATCHED:           [],
  CANCELLED:            [],
  // New workflow — transitions managed via dedicated API endpoints, not the generic status route
  AWAITING_INBOUND:     [],
  AWAITING_CS:          [],
  WAITING_FOR_MECHANIC: [],
  DISPUTED:             ['WAITING_FOR_MECHANIC', 'CANCELLED'],
  QUALITY_CONTROL:      [],
  QC_FAILED:            [],
  BGRADE_RECORDED:      ['QUALITY_CONTROL', 'CANCELLED'],
}

export const changeStatusSchema = z.object({
  status: z.nativeEnum(RepairStatus),
  notes:  z.string().max(500).optional(),
})

export const addRepairPartSchema = z.object({
  partId:   z.string().cuid(),
  quantity: z.number().int().positive().max(100),
})

export type CreateRepairInput = z.infer<typeof createRepairSchema>
export type UpdateRepairInput = z.infer<typeof updateRepairSchema>