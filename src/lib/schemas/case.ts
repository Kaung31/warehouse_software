import { z } from 'zod'

// Enums as string literals (avoids stale Prisma client TS cache issues)
const ErrorCodeEnum = z.enum([
  'E01','E02','E03','E04','E05','E06','E07','E08','E09','E10',
  'PHYSICAL_CRACK','PHYSICAL_BATTERY','PHYSICAL_WHEEL','PHYSICAL_BRAKE','PHYSICAL_DISPLAY','OTHER',
])

const CaseTypeEnum  = z.enum(['WARRANTY', 'BGRADE'])
const PriorityEnum  = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
const PaymentStatusEnum = z.enum(['PAID', 'UNPAID', 'DISPUTED', 'WARRANTY_APPROVED'])
const QCResultEnum  = z.enum(['PASS', 'FAIL', 'NA'])

// POST /api/cases/intake  (Stage 1 — CS creates the case folder)
export const intakeSchema = z.object({
  serialNumber:     z.string().min(1).max(50),
  brand:            z.string().min(1).max(100),
  model:            z.string().min(1).max(100),
  caseType:         CaseTypeEnum,
  // Customer (required for WARRANTY, optional for BGRADE)
  customerName:     z.string().min(1).max(100).optional(),
  customerPostcode: z.string().regex(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i).optional(),
  customerPhone:    z.string().max(20).optional(),
  customerEmail:    z.string().email().optional(),
  // Invoice (required for WARRANTY)
  invoiceNumber:    z.string().max(100).optional(),
  // Customer complaint — error codes NOT collected here (Inbound does that)
  faultDescription: z.string().min(3).max(2000),
  internalNotes:    z.string().max(1000).optional(),
  priority:         PriorityEnum.default('NORMAL'),
}).superRefine((d, ctx) => {
  if (d.caseType === 'WARRANTY') {
    if (!d.customerName)
      ctx.addIssue({ code: 'custom', path: ['customerName'],     message: 'Required for warranty cases' })
    if (!d.customerPostcode)
      ctx.addIssue({ code: 'custom', path: ['customerPostcode'], message: 'Required for warranty cases' })
    if (!d.invoiceNumber)
      ctx.addIssue({ code: 'custom', path: ['invoiceNumber'],    message: 'Required for warranty cases' })
  }
})

// POST /api/cases/[id]/inbound-triage  (Stage 2 — Inbound scans arrival, adds diagnosis)
export const inboundTriageSchema = z.object({
  errorCodes:  z.array(ErrorCodeEnum).min(1, 'Select at least one error code'),
  diagnosis:   z.string().min(3).max(2000),
  internalNotes: z.string().max(1000).optional(),
})

// POST /api/cases/[id]/cs-update
export const csUpdateSchema = z.object({
  comment:       z.string().min(1).max(2000).optional(),
  isCustomerFacing: z.boolean().default(false),
  paymentStatus: PaymentStatusEnum.optional(),
  // If provided, triggers a status transition
  approveForMechanic: z.boolean().optional(),
  markDisputed:       z.boolean().optional(),
})

// POST /api/cases/[id]/qc-submit
export const qcSubmitSchema = z.object({
  results: z.array(z.object({
    templateId: z.string().min(1),
    result:     QCResultEnum,
    notes:      z.string().max(500).optional(),
    photoS3Key: z.string().optional(),
  })).min(1),
})

// POST /api/cases/[id]/complete-repair
export const completeRepairSchema = z.object({
  diagnosis: z.string().min(3).max(2000),
  resolution: z.string().min(3).max(2000).optional(),
  repairNotes: z.string().max(2000).optional(),
})

export type IntakeInput          = z.infer<typeof intakeSchema>
export type InboundTriageInput   = z.infer<typeof inboundTriageSchema>
export type CSUpdateInput        = z.infer<typeof csUpdateSchema>
export type QCSubmitInput        = z.infer<typeof qcSubmitSchema>
export type CompleteRepairInput  = z.infer<typeof completeRepairSchema>
