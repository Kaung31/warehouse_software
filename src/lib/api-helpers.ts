import { NextRequest, NextResponse } from 'next/server'
import { ZodSchema, ZodError } from 'zod'
import * as Sentry from '@sentry/nextjs'
import type { Scope } from '@sentry/nextjs'
import { nanoid } from 'nanoid'
import { logger, withCorrelation } from './logger'
import { auth } from '@clerk/nextjs/server'

export { requireAuth } from '@/lib/auth'

/* ─── Response helpers ──────────────────────────────────────────────── */

export function apiSuccess<T>(data: T, status = 200, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, { status, ...init })
}

export function apiError(message: string, status: number, init?: ResponseInit) {
  return NextResponse.json({ success: false, error: message }, { status, ...init })
}

/* ─── Body parser ───────────────────────────────────────────────────── */

export async function parseBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): Promise<{ data: T; error: null } | { data: null; error: NextResponse }> {
  try {
    const body = await request.json()
    const data = schema.parse(body)
    return { data, error: null }
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ')
      return { data: null, error: apiError(`Validation failed: ${messages}`, 400) }
    }
    return { data: null, error: apiError('Invalid request body', 400) }
  }
}

/* ─── Error handler ─────────────────────────────────────────────────── */

/**
 * Wraps a route handler with:
 *   - Correlation ID generation (stamped onto the response header
 *     `x-correlation-id` so a user reporting a bug can quote it).
 *   - Structured logging (request in / response out).
 *   - Sentry error capture with user context (Clerk userId + role) and
 *     request metadata.
 *   - Friendly mapping of `UNAUTHENTICATED` / `FORBIDDEN` thrown by
 *     `requireAuth()` into 401 / 403 responses.
 *
 * The contract for handlers is mostly unchanged. The third positional
 * arg `requestId` is the request's correlation id — handlers that use
 * `withAuditedTransaction` pass it through to `opts.requestId` so the
 * audit_log row, the request log line, and the response header all
 * carry the same id. Handlers that don't need it can just ignore the
 * extra parameter.
 */
export function withErrorHandler(
  handler: (req: NextRequest, ctx?: unknown, requestId?: string) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx?: unknown) => {
    // The browser may pass an upstream correlation id (e.g. from a load
    // balancer); reuse it so the trace stays linked end-to-end.
    const correlationId =
      req.headers.get('x-correlation-id') ?? nanoid(12)
    const reqLog = withCorrelation(correlationId, {
      method: req.method,
      path:   new URL(req.url).pathname,
    })
    const startedAt = Date.now()

    try {
      const res = await handler(req, ctx, correlationId)
      res.headers.set('x-correlation-id', correlationId)
      reqLog.info({ status: res.status, ms: Date.now() - startedAt }, 'request ok')
      return res
    } catch (err) {
      // Friendly mappings before we ship to Sentry — auth thrown errors
      // are expected business logic, not bugs.
      if (err instanceof Error) {
        if (err.message === 'UNAUTHENTICATED') {
          reqLog.info({ ms: Date.now() - startedAt }, 'request unauthenticated')
          const res = apiError('Not authenticated', 401)
          res.headers.set('x-correlation-id', correlationId)
          return res
        }
        if (err.message === 'FORBIDDEN') {
          reqLog.info({ ms: Date.now() - startedAt }, 'request forbidden')
          const res = apiError('You do not have permission to do this', 403)
          res.headers.set('x-correlation-id', correlationId)
          return res
        }
      }

      // Real error — log + Sentry.
      reqLog.error({ err, ms: Date.now() - startedAt }, 'request failed')
      try {
        // Attach Clerk identity (best-effort — auth() may throw on
        // unauthenticated public routes; that's fine).
        let userTag: { id?: string; ip?: string } = {}
        try {
          const a = await auth()
          if (a.userId) userTag = { id: a.userId }
        } catch {/* public route */}

        Sentry.withScope((scope: Scope) => {
          scope.setTag('correlation_id', correlationId)
          scope.setContext('request', {
            method: req.method,
            url:    req.url,
            path:   new URL(req.url).pathname,
          })
          if (userTag.id) scope.setUser(userTag)
          Sentry.captureException(err)
        })
      } catch (captureErr) {
        // Sentry's own SDK should never bring down our 500-handler.
        logger.warn({ err: captureErr }, 'Sentry captureException failed')
      }

      const res = apiError('Internal server error', 500)
      res.headers.set('x-correlation-id', correlationId)
      return res
    }
  }
}
