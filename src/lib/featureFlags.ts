/**
 * Phase 8 — feature flags.
 *
 * Thin wrapper over `posthog-server.ts` so callers don't have to know
 * about PostHog directly. Returns the typed flag value or a default.
 *
 * Conventions:
 *   - Flag keys live in `KNOWN_FLAGS` so the type system catches typos.
 *   - Default is always "off" (false / null) so a missing PostHog
 *     project doesn't accidentally turn a feature on.
 *
 * Suggested first three flags (per the brief — gate the next 3 features
 * behind these):
 *
 *   1. `dispatch-v2`           — re-write of the dispatch flow.
 *   2. `bulk-photo-upload`     — drag-and-drop multi-file picker.
 *   3. `mechanic-leaderboard`  — gamified weekly stats on /workshop.
 */

import { getFeatureFlag } from './posthog-server'

export const KNOWN_FLAGS = {
  'dispatch-v2':          { default: false as boolean },
  'bulk-photo-upload':    { default: false as boolean },
  'mechanic-leaderboard': { default: false as boolean },
} as const

export type FlagKey = keyof typeof KNOWN_FLAGS

/** Server-side: look up a boolean flag for the user. */
export async function isEnabled(userId: string, key: FlagKey): Promise<boolean> {
  const value = await getFeatureFlag(userId, key)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string')  return value === 'true' || value === 'on'
  return KNOWN_FLAGS[key].default
}

/** Server-side: look up multiple flags in one call. */
export async function getFlags(
  userId: string,
  keys:   readonly FlagKey[],
): Promise<Record<FlagKey, boolean>> {
  const out: Partial<Record<FlagKey, boolean>> = {}
  await Promise.all(keys.map(async (k) => { out[k] = await isEnabled(userId, k) }))
  return out as Record<FlagKey, boolean>
}
