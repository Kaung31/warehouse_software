/**
 * Sentry — Node.js (server) initialisation.
 *
 * Used by route handlers and server components. The Edge runtime has
 * its own config below.
 */

import * as Sentry from '@sentry/nextjs'
import type { ErrorEvent, EventHint, StackFrame } from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release:     process.env.SENTRY_RELEASE,            // git SHA from CI
    tracesSampleRate: 0.1,

    // Strip noisy Prisma engine internal stack frames.
    beforeSend(event: ErrorEvent, _hint: EventHint) {
      if (event.exception?.values?.[0]?.stacktrace?.frames) {
        event.exception.values[0].stacktrace.frames =
          event.exception.values[0].stacktrace.frames.filter(
            (f: StackFrame) => !(f.filename ?? '').includes('node_modules/@prisma/client'),
          )
      }
      return event
    },
  })
}
