import { NextRequest } from 'next/server'
import { z } from 'zod'
import { parseBody, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { signTrackToken } from '@/lib/track-token'
import { checkLookupRateLimit } from '@/lib/track-rate-limit'

/**
 * POST /api/track/lookup
 *
 * Public, unauthenticated. Customer enters their order number and a
 * verification (email OR last 4 digits of phone). We match them against
 * the linked Customer; on success we mint a 1-hour JWT they can use to
 * load /api/track/[orderNumber].
 *
 * Security posture:
 *   - Generic error for ANY mismatch (don't reveal whether the order
 *     exists or which field was wrong — guards against enumeration).
 *   - Rate limited (5/min/IP) by lib/track-rate-limit.ts.
 *   - Only WARRANTY cases are addressable through the portal — B-grade
 *     cases are internal refurbishment with no customer.
 */

const schema = z.object({
  orderNumber:  z.string().min(1).max(60),
  verification: z.string().min(1).max(120),
})

const GENERIC_ERROR = "Couldn't find a matching repair. Please double-check your details."

export const POST = withErrorHandler(async (req: NextRequest) => {
  // Rate limit first so an attacker can't enumerate by brute force.
  // Now async — backed by Upstash Redis in production (sliding window).
  const rl = await checkLookupRateLimit(req)
  if (!rl.ok) {
    return apiError(
      `Too many lookups. Please wait ${rl.retryAfter} seconds and try again.`,
      429,
    )
  }

  const { data, error } = await parseBody(req, schema)
  if (error) return error

  const orderNumber  = data.orderNumber.trim()
  const verification = data.verification.trim()

  // Find the case + customer in a single round trip.
  const repair = await prisma.repairOrder.findUnique({
    where:  { orderNumber },
    select: {
      id:       true,
      caseType: true,
      customer: { select: { email: true, phone: true } },
    },
  })

  // Always behave the same on miss vs. mismatch.
  if (!repair || repair.caseType !== 'WARRANTY') {
    return apiError(GENERIC_ERROR, 404)
  }

  if (!verifyMatches(verification, repair.customer)) {
    return apiError(GENERIC_ERROR, 404)
  }

  const token = await signTrackToken(repair.id)
  return apiSuccess({ orderNumber, token })
})

/** Verification accepts either:
 *    - the customer's email (case-insensitive, trimmed)
 *    - the last 4 digits of the customer's phone number (digits only)
 *  Returns true on the first matching strategy.
 */
function verifyMatches(
  input:    string,
  customer: { email: string | null; phone: string | null } | null,
): boolean {
  if (!customer) return false

  // Email path.
  if (input.includes('@') && customer.email) {
    return input.toLowerCase() === customer.email.toLowerCase()
  }

  // Phone last-4 path. Strip non-digits from both sides for resilience
  // against spaces / dashes the customer might type.
  const digits = input.replace(/\D/g, '')
  if (digits.length === 4 && customer.phone) {
    const last4 = customer.phone.replace(/\D/g, '').slice(-4)
    return last4.length === 4 && digits === last4
  }

  return false
}
