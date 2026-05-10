/**
 * Phase 2 — distributed locks via Upstash Redis.
 *
 * Used to serialise stock-decrement transactions so two mechanics
 * can't double-spend the last unit of a part. We acquire a key like
 * `sh:lock:part:<partId>` with a short TTL, run the critical section,
 * release the key.
 *
 * Algorithm: Redis SET NX EX (atomic). If the lock is held we retry
 * with exponential backoff up to `maxWaitMs`. If acquisition fails,
 * the caller decides what to do (typically: surface a friendly retry
 * error so the mechanic just clicks again).
 *
 * Fail-soft: with no Upstash configured, `withLock()` runs the
 * critical section directly. Local dev still works — the only thing
 * we lose is the cross-instance guarantee, which doesn't apply at
 * one process anyway.
 */

import { Redis } from '@upstash/redis'
import { nanoid } from 'nanoid'
import { logger } from './logger'

let _redis: Redis | null = null
function redis(): Redis | null {
  if (_redis) return _redis
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  _redis = Redis.fromEnv()
  return _redis
}

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`.trim()

export type LockOptions = {
  /** Max time the critical section may hold the lock (seconds). */
  ttlSeconds?:  number
  /** Max time to wait for an existing lock to be released (ms). */
  maxWaitMs?:   number
  /** Initial backoff between retries (ms). Doubles each retry, capped at 1s. */
  initialBackoffMs?: number
}

const DEFAULTS: Required<LockOptions> = {
  ttlSeconds:       10,
  maxWaitMs:        3_000,
  initialBackoffMs: 50,
}

/**
 * Run `fn` while holding the named lock. Releases the lock even if
 * `fn` throws. Throws `LOCK_BUSY` if it can't acquire within
 * `maxWaitMs` — caller should map that to a friendly error.
 */
export async function withLock<T>(
  name: string,
  fn:   () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const r = redis()
  if (!r) return fn() // dev fallback

  const { ttlSeconds, maxWaitMs, initialBackoffMs } = { ...DEFAULTS, ...opts }
  const key   = `sh:lock:${name}`
  const token = nanoid(16)
  const start = Date.now()
  let backoff = initialBackoffMs

  // Acquire (with retry).
  while (true) {
    try {
      const acquired = await r.set(key, token, { nx: true, ex: ttlSeconds })
      if (acquired === 'OK') break
    } catch (err) {
      logger.warn({ err, key }, 'lock acquire errored — retrying')
    }
    if (Date.now() - start > maxWaitMs) throw new Error('LOCK_BUSY')
    await new Promise((res) => setTimeout(res, backoff))
    backoff = Math.min(backoff * 2, 1000)
  }

  // Critical section.
  try {
    return await fn()
  } finally {
    // Release — atomic check-and-delete via Lua so we only release our
    // own lock (a slow critical section that exceeded TTL might find
    // someone else has acquired).
    try {
      await r.eval(RELEASE_LUA, [key], [token])
    } catch (err) {
      logger.warn({ err, key }, 'lock release errored')
    }
  }
}

/** Convenience: lock keyed to a single part. */
export function withPartLock<T>(partId: string, fn: () => Promise<T>) {
  return withLock(`part:${partId}`, fn, { ttlSeconds: 10, maxWaitMs: 3_000 })
}
