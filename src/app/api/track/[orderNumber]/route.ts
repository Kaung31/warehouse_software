import { NextRequest } from 'next/server'
import { apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { verifyTrackToken } from '@/lib/track-token'
import { serializePublicTrack } from '@/lib/trackPublicSerializer'

/**
 * GET /api/track/[orderNumber]?token=...
 *
 * Public, unauthenticated. Reads the signed token, validates it, and
 * returns the strict whitelist payload.
 *
 * Errors:
 *   - 401 token missing / expired / invalid
 *   - 401 token doesn't match the requested orderNumber (so swapping
 *     the URL doesn't reveal someone else's repair)
 *   - 404 the order doesn't exist or isn't a WARRANTY case
 */

type Ctx = { params: Promise<{ orderNumber: string }> }

export const GET = withErrorHandler(async (req: NextRequest, ctx: unknown) => {
  const { orderNumber } = await (ctx as Ctx).params

  const token = req.nextUrl.searchParams.get('token')
  if (!token) return apiError('Verification token is required.', 401)

  const payload = await verifyTrackToken(token)
  if (!payload) {
    return apiError('Verification link expired. Please look up your order again.', 401)
  }

  const repair = await prisma.repairOrder.findUnique({
    where:  { id: payload.orderId },
    select: { id: true, orderNumber: true, caseType: true },
  })
  if (!repair) return apiError('Order not found.', 404)
  if (repair.caseType !== 'WARRANTY') return apiError('Order not found.', 404)

  // Cross-check: the token's orderId must match the URL's orderNumber.
  // Otherwise an attacker who's lifted someone's token could feed it
  // any URL and harvest data.
  if (repair.orderNumber !== orderNumber) {
    return apiError('Verification link does not match this order.', 401)
  }

  const data = await serializePublicTrack(payload.orderId)
  if (!data) return apiError('Order not found.', 404)

  return apiSuccess(data)
})
