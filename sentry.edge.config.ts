/**
 * Sentry — Edge runtime (middleware + edge route handlers).
 *
 * Currently only `src/proxy.ts` runs on edge. Sentry's edge SDK is a
 * stripped-down build that doesn't include Replay or Profiling.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment:      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release:          process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
  })
}
