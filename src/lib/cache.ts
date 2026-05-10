/**
 * Phase 2 — distributed cache for read-heavy dashboard queries.
 *
 * Keyed by `${role}:${endpoint}:${userId}` so each user gets their own
 * filtered view. 5-minute default TTL — short enough that stale data
 * is bounded, long enough to absorb the kanban board's polling.
 *
 * Invalidation: status-change endpoints call `invalidateCaseCache()`
 * after the transaction commits. We blow a deliberately wide swath
 * (every dashboard for every role + the case-detail key) — these are
 * cheap to recompute and cache misses are fine.
 *
 * Fail-soft: if Upstash isn't configured, `cached()` just runs the
 * factory directly. Local dev still works.
 */

import { Redis } from '@upstash/redis'
import { logger } from './logger'

const DEFAULT_TTL_SECONDS = 5 * 60

let _redis: Redis | null = null
function redis(): Redis | null {
  if (_redis) return _redis
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  _redis = Redis.fromEnv()
  return _redis
}

/**
 * Get-or-set with a typed factory. Cache the result of `factory()`
 * for `ttlSeconds`, keyed by the namespaced key.
 *
 * Returns the cached value (or the freshly computed one) — the caller
 * doesn't need to know whether it was a hit or miss.
 */
export async function cached<T>(
  key:        string,
  factory:    () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<T> {
  const r = redis()
  if (!r) return factory()

  const fullKey = `sh:cache:${key}`
  try {
    const hit = await r.get<T>(fullKey)
    if (hit !== null && hit !== undefined) return hit as T
  } catch (err) {
    // Read failures are non-fatal — recompute.
    logger.warn({ err, key: fullKey }, 'cache read failed')
  }

  const fresh = await factory()
  try {
    await r.set(fullKey, fresh, { ex: ttlSeconds })
  } catch (err) {
    logger.warn({ err, key: fullKey }, 'cache write failed')
  }
  return fresh
}

/**
 * Build a dashboard cache key from the parts that should produce a
 * unique view. Always namespaces on role + endpoint so a manager and
 * a CS user looking at the same /dashboard URL don't share a cache.
 */
export function dashboardKey(args: {
  role:     string
  endpoint: string
  userId:   string
}): string {
  return `dash:${args.role}:${args.endpoint}:${args.userId}`
}

/**
 * Wipe every cached dashboard view for every role plus any case-scoped
 * keys for `caseId`. Called from API endpoints that change a case's
 * status / parts / payment / location.
 *
 * This is intentionally aggressive — cache-busting bugs are far more
 * subtle to debug than a few extra DB queries.
 */
export async function invalidateCaseCache(caseId?: string): Promise<void> {
  const r = redis()
  if (!r) return

  // Two scans, one for dashboard views, one for case-scoped keys.
  const patterns = ['sh:cache:dash:*']
  if (caseId) patterns.push(`sh:cache:case:${caseId}:*`)

  try {
    for (const pattern of patterns) {
      let cursor = 0
      do {
        const result = await r.scan(cursor, { match: pattern, count: 100 })
        cursor = Number(result[0]) || 0
        const keys = result[1]
        if (keys.length > 0) {
          await r.del(...keys)
        }
      } while (cursor !== 0)
    }
  } catch (err) {
    logger.warn({ err, caseId }, 'cache invalidation failed')
  }
}

/** Wipe a single specific cache key. Used when we know the exact
 *  key to bust (e.g. a user's notification list). */
export async function invalidate(key: string): Promise<void> {
  const r = redis()
  if (!r) return
  try {
    await r.del(`sh:cache:${key}`)
  } catch (err) {
    logger.warn({ err, key }, 'cache invalidation failed')
  }
}
