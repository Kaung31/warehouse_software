import type { PaymentInfo } from '@/components/cases/PaymentInfoBanner'

/**
 * Extract payment-related fields from a RepairOrder for the banner.
 * Pass the case object (with `invoice` included) and get back a
 * PaymentInfo ready to feed to <PaymentInfoBanner data={...} />.
 */
export function paymentInfoFromCase(c: {
  customerPrepaid: boolean
  csPaymentNote: string | null
  warrantyConfirmed: boolean
  quoteAmount: { toString(): string } | number | null
  quotedAt: Date | null
  quoteApprovedAt: Date | null
  rechargeAmount: { toString(): string } | number | null
  rechargeReason: string | null
  customerApprovedAt: Date | null
  invoice: {
    invoiceNumber: string | null
    paymentStatus:
      | 'PAID'
      | 'UNPAID'
      | 'DISPUTED'
      | 'WARRANTY_APPROVED'
      | 'PARTIAL'
      | 'REFUNDED'
  } | null
}): PaymentInfo {
  return {
    customerPrepaid: c.customerPrepaid,
    csPaymentNote: c.csPaymentNote,
    warrantyConfirmed: c.warrantyConfirmed,
    quoteAmount:
      c.quoteAmount != null ? Number(c.quoteAmount.toString()) : null,
    quotedAt: c.quotedAt,
    quoteApprovedAt: c.quoteApprovedAt,
    rechargeAmount:
      c.rechargeAmount != null ? Number(c.rechargeAmount.toString()) : null,
    rechargeReason: c.rechargeReason,
    customerApprovedAt: c.customerApprovedAt,
    invoiceNumber: c.invoice?.invoiceNumber ?? null,
    paymentStatus: c.invoice?.paymentStatus ?? null,
  }
}