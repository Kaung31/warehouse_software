/**
 * PostHog — server-side (analytics events + feature flags).
 *
 * `posthog-node` is event-driven, so we must `await client.shutdown()`
 * at the end of a Lambda / serverless invocation to avoid losing the
 * tail. On a long-running Railway container this matters less but
 * we still call it from `process.on('beforeExit')`.
 *
 * Feature-flag evaluation runs against PostHog's local cache after
 * the first call, so `getFeatureFlag()` is fast.
 */

import { PostHog } from 'posthog-node'

let _client: PostHog | null = null

function client(): PostHog | null {
  if (_client) return _client
  const key  = process.env.POSTHOG_API_KEY
  const host = process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com'
  if (!key) return null
  _client = new PostHog(key, { host, flushAt: 1, flushInterval: 1000 })
  return _client
}

/** Identify a user — call this on first authenticated request per session. */
export function identify(userId: string, properties?: Record<string, unknown>) {
  client()?.identify({ distinctId: userId, properties })
}

/** Capture a server-side event. Fire-and-forget. */
export function capture(
  userId: string,
  event:  string,
  properties?: Record<string, unknown>,
) {
  client()?.capture({ distinctId: userId, event, properties })
}

/** Look up a feature-flag value for a user. Returns undefined when
 *  PostHog isn't configured — callers should default to "off". */
export async function getFeatureFlag(
  userId: string,
  key:    string,
): Promise<string | boolean | undefined> {
  const c = client()
  if (!c) return undefined
  try {
    return await c.getFeatureFlag(key, userId)
  } catch {
    return undefined
  }
}

/** Optional: explicit shutdown for graceful exits. */
export async function shutdownPostHog() {
  if (_client) {
    try { await _client.shutdown() } catch {/* ignore */}
    _client = null
  }
}
