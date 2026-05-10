/**
 * Sentry — browser-side initialisation.
 *
 * Loaded on every client component. Fail-soft: if SENTRY_DSN is missing
 * (e.g. local dev without observability) Sentry stays disabled and
 * nothing throws.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release:     process.env.NEXT_PUBLIC_SENTRY_RELEASE, // git SHA, set in CI
    // Send 10% of regular traces; 100% on errors
    tracesSampleRate:        0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.replayIntegration({
        // Privacy: mask form inputs by default. PostHog also respects
        // this convention.
        maskAllInputs: true,
        maskAllText:   false,
        blockAllMedia: false,
      }),
    ],

    // Don't ship transient browser noise to Sentry.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications.',
      // Clerk drops transient session errors during background refresh.
      'ClerkJS: Failed to fetch',
    ],
  })
}
