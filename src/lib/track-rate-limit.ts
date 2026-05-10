/**
 * Phase B → Production migration:
 *
 * Distributed rate limiter for the public lookup endpoint, backed by
 * Upstash Redis via `@upstash/ratelimit`'s sliding-window algorithm.
 *
 * Same public interface as the v1 in-memory implementation
 * (`checkLookupRateLimit(req)` returning `{ ok, remaining, retryAfter }`)
 * so callers don't change.
 *
 * If Upstash isn't configured (local dev with no creds), we fall back
 * to a per-process Map so the endpoint isn't completely unguarded.
 * Only the production deploy gets the distributed behaviour.
 *
 * Limits: 5 requests / minute / IP. Tunable via the constants below.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { NextRequest } from 'next/server'

const WINDOW = '1 m'
const MAX    = 5

/* ─── Upstash-backed limiter (preferred) ──────────────────────────── */

let _upstash: Ratelimit | null = null
function upstash(): Ratelimit | null {
  if (_upstash) return _upstash
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  _upstash = new Ratelimit({
    redis:     Redis.fromEnv(),
    limiter:   Ratelimit.slidingWindow(MAX, WINDOW),
    analytics: true,
    prefix:    'sh:lookup',
  })
  return _upstash
}

/* ─── In-memory fallback (dev only) ───────────────────────────────── */

const WINDOW_MS = 60 * 1000
type Bucket = { count: number; resetAt: number }
const memBuckets = new Map<string, Bucket>()

function memCheck(key: string): { ok: boolean; remaining: number; retryAfter: number } {
  const now      = Date.now()
  const existing = memBuckets.get(key)
  if (!existing || existing.resetAt < now) {
    memBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { ok: true, remaining: MAX - 1, retryAfter: 0 }
  }
  if (existing.count >= MAX) {
    return {
      ok:         false,
      remaining:  0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }
  existing.count++
  return { ok: true, remaining: MAX - existing.count, retryAfter: 0 }
}

/* ─── Client-key extraction ───────────────────────────────────────── */

function clientKey(req: NextRequest): string {
  const fwd  = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'anonymous'
}

/* ─── Public API ──────────────────────────────────────────────────── */

export async function checkLookupRateLimit(req: NextRequest): Promise<{
  ok:         boolean
  remaining:  number
  retryAfter: number
}> {
  const key = `lookup:${clientKey(req)}`
  const r   = upstash()
  if (!r) return memCheck(key)

  try {
    const result = await r.limit(key)
    return {
      ok:         result.success,
      remaining:  result.remaining,
      retryAfter: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    }
  } catch {
    // If Upstash is briefly unreachable we fail OPEN — better to let
    // a real customer through than to deny everyone. Sentry will catch
    // the underlying connection error via withErrorHandler if it
    // bubbles further.
    return { ok: true, remaining: MAX - 1, retryAfter: 0 }
  }
}
