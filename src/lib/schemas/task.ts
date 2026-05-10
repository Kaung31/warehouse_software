import { z } from 'zod'

// Used by POST /api/cases/[id]/tasks
export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  notes: z.string().max(2000).optional(),
})

// Used by PATCH /api/cases/[id]/tasks/[taskId]
//
// Any field is optional — clients send only what changed (auto-save).
// `completed: true`  → completedAt = now, completedById = me
// `completed: false` → completedAt = null, completedById = null
// `order` change     → server reindexes adjacent tasks
export const updateTaskSchema = z
  .object({
    title:     z.string().min(1).max(200).optional(),
    notes:     z.string().max(2000).nullable().optional(),
    completed: z.boolean().optional(),
    order:     z.number().int().min(0).optional(),
  })
  .refine(
    (d) => Object.keys(d).length > 0,
    { message: 'At least one field must be provided' },
  )

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

// Used by PATCH /api/cases/[id]/mechanic-notes
//
// Small endpoint dedicated to the workshop's auto-save-on-blur notes
// textarea. Writes to RepairOrder.internalNotes (no schema change).
export const mechanicNotesSchema = z.object({
  notes: z.string().max(4000).nullable(),
})
export type MechanicNotesInput = z.infer<typeof mechanicNotesSchema>
