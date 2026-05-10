import { z } from 'zod'

const ErrorCodeEnum = z.enum([
  'E01','E02','E03','E04','E05','E06','E07','E08','E09','E10',
  'PHYSICAL_CRACK','PHYSICAL_BATTERY','PHYSICAL_WHEEL','PHYSICAL_BRAKE','PHYSICAL_DISPLAY','OTHER',
])

const CaseTypeEnum      = z.enum(['WARRANTY', 'BGRADE'])
const PriorityEnum      = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
const PaymentStatusEnum = z.enum(['PAID', 'UNPAID', 'DISPUTED', 'WARRANTY_APPROVED'])
const QCResultEnum      = z.enum(['PASS', 'FAIL', 'NA'])

export const intakeSchema = z.object({
  serialNumber:      z.string().min(1).max(50),
  brand:             z.string().min(1).max(100),
  model:             z.string().min(1).max(100),
  caseType:          CaseTypeEnum,
  customerName:      z.string().min(1).max(100).optional(),
  customerPostcode:  z.string().regex(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i).optional(),
  customerPhone:     z.string().max(20).optional(),
  customerEmail:     z.string().email().optional(),
  invoiceNumber:     z.string().max(100).optional(),
  faultDescription:  z.string().min(3).max(2000),
  internalNotes:     z.string().max(1000).optional(),
  priority:          PriorityEnum.default('NORMAL'),
  customerPrepaid:   z.boolean().default(false),
  csPaymentNote:     z.string().max(1000).optional(),
  warrantyConfirmed: z.boolean().default(false),  // CS confirms warranty coverage
  source:            z.string().max(100).optional(), // BGRADE: where it came from
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

// Inbound triage — inbound team manually decides routing (sendToMechanic or back to CS)
export const inboundTriageSchema = z.object({
  errorCodes:     z.array(ErrorCodeEnum).min(1, 'Select at least one error code'),
  diagnosis:      z.string().min(3).max(2000),
  internalNotes:  z.string().max(1000).optional(),
  sendToMechanic: z.boolean().default(false), // inbound decides: true=skip CS gate, false=notify CS
})

export const bgradeInboundSchema = z.object({
  internalNotes: z.string().max(1000).optional(),
  palletId:      z.string().optional(),
})

export const csUpdateSchema = z.object({
  comment:            z.string().min(1).max(2000).optional(),
  isCustomerFacing:   z.boolean().default(false),
  paymentStatus:      PaymentStatusEnum.optional(),
  customerPrepaid:    z.boolean().optional(),
  csPaymentNote:      z.string().max(1000).optional(),
  warrantyConfirmed:  z.boolean().optional(),
  approveForMechanic: z.boolean().optional(),
  markDisputed:       z.boolean().optional(),
})

export const qcSubmitSchema = z.object({
  results: z.array(z.object({
    templateId: z.string().min(1),
    result:     QCResultEnum,
    notes:      z.string().max(500).optional(),
    photoS3Key: z.string().optional(),
  })).min(1),
  palletId: z.string().optional(),
})

export const completeRepairSchema = z.object({
  diagnosis:    z.string().min(3).max(2000),
  resolution:   z.string().min(3).max(2000).optional(),
  repairNotes:  z.string().max(2000).optional(),
  // BGRADE mechanic grading fields (optional — only for BGRADE cases)
  colour:       z.string().max(50).optional(),
  totalMileage: z.number().int().min(0).optional(),
  grade:        z.enum(['A', 'B', 'C']).optional(),
})

export type IntakeInput         = z.infer<typeof intakeSchema>
export type InboundTriageInput  = z.infer<typeof inboundTriageSchema>
export type BgradeInboundInput  = z.infer<typeof bgradeInboundSchema>
export type CSUpdateInput       = z.infer<typeof csUpdateSchema>
export type QCSubmitInput       = z.infer<typeof qcSubmitSchema>
export type CompleteRepairInput = z.infer<typeof completeRepairSchema>
