'use client'

/**
 * PostHog — browser-side bootstrap.
 *
 * Mounted once in the root layout. Initialises only when the
 * NEXT_PUBLIC_POSTHOG_KEY env var is present so local dev without
 * observability stays silent.
 *
 * Privacy model:
 *   - Form inputs masked by default (matches the Sentry replay config).
 *   - Sample 10 % of regular sessions; 100 % of sessions that hit an
 *     error.
 *   - We do not capture URL params on the public /track pages — those
 *     contain a token that, while short-lived, shouldn't end up in an
 *     analytics dashboard.
 */

import { useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import posthog from 'posthog-js'

let initialised = false

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()

  useEffect(() => {
    const key  = process.env.NEXT_PUBLIC_POSTHOG_KEY
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
    if (!key || initialised || typeof window === 'undefined') return
    initialised = true
    posthog.init(key, {
      api_host:                host,
      person_profiles:         'identified_only',
      capture_pageview:        true,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: undefined,
      },
      // Skip recording on the customer tracking pages so the token
      // never ends up captured.
      sanitize_properties: (properties: Record<string, unknown>) => {
        const url = properties.$current_url
        if (typeof url === 'string' && url.includes('/track/')) {
          properties.$current_url = url.split('?')[0]
        }
        return properties
      },
    })
  }, [])

  // When auth lands, link the anonymous session to the Clerk user id.
  useEffect(() => {
    if (!initialised || !user) return
    posthog.identify(user.id, {
      email: undefined, // never to PostHog
      role:  user.publicMetadata?.role,
    })
  }, [user])

  return <>{children}</>
}
