/**
 * Phase B — short-lived signed tokens for the customer tracking portal.
 *
 * Tokens contain ONLY:
 *   - orderId (so the detail endpoint knows which case to load)
 *   - exp     (the 1-hour expiry; jose verifies this for us)
 *
 * No PII, no email, no phone. If TRACK_TOKEN_SECRET isn't set we fail
 * fast in development; in production this should crash the deploy
 * rather than silently accept any input.
 *
 * Implemented with `jose` (edge-compatible) so the lookup and detail
 * endpoints both work on the Next.js edge runtime if we want them
 * there later.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'

const TOKEN_TTL_SECONDS = 60 * 60 // 1 hour
const ISSUER   = 'scooterhub-track'
const AUDIENCE = 'scooterhub-customer'

function getKey(): Uint8Array {
  const secret = process.env.TRACK_TOKEN_SECRET
  if (!secret || secret.length < 16) {
    throw new Error(
      'TRACK_TOKEN_SECRET is missing or too short. Add at least a 32-char random string to .env (see .env.example).',
    )
  }
  return new TextEncoder().encode(secret)
}

export type TrackTokenPayload = {
  orderId:  string
  iat:      number
  exp:      number
}

export async function signTrackToken(orderId: string): Promise<string> {
  return new SignJWT({ orderId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getKey())
}

/** Returns the payload on success, or null on any verification failure
 *  (expired, wrong signature, malformed). The caller should surface a
 *  generic "verification expired" UI rather than the specific reason. */
export async function verifyTrackToken(
  token: string,
): Promise<TrackTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer:   ISSUER,
      audience: AUDIENCE,
    })
    if (typeof payload.orderId !== 'string') return null
    return {
      orderId: payload.orderId,
      iat:     typeof payload.iat === 'number' ? payload.iat : 0,
      exp:     typeof payload.exp === 'number' ? payload.exp : 0,
    }
  } catch (err) {
    // Don't leak which check failed — log internally for debugging.
    if (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWTInvalid ||
      err instanceof joseErrors.JWSInvalid
    ) {
      return null
    }
    console.error('[track-token] verify error:', err)
    return null
  }
}

export const TRACK_TOKEN_TTL_SECONDS = TOKEN_TTL_SECONDS
