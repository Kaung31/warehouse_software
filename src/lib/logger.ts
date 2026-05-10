/**
 * Structured logging with pino.
 *
 * Why pino: fastest JSON logger for Node, plays nicely with log
 * aggregators (Better Stack), and `pino-pretty` makes local dev
 * readable.
 *
 * Correlation IDs:
 *   - Generated once per request in withErrorHandler / each route.
 *   - Threaded into every log statement via `child` loggers.
 *   - Surfaced on response headers as `x-correlation-id` so when a
 *     user reports a problem we can grep the logs by that single ID.
 *
 * Better Stack:
 *   - Forwards via the HTTP transport when BETTER_STACK_SOURCE_TOKEN is
 *     set. Without it we just pretty-print to stdout — fine for dev.
 */

import pino, { type Logger } from 'pino'

const isDev   = process.env.NODE_ENV === 'development'
const bsToken = process.env.BETTER_STACK_SOURCE_TOKEN
const bsHost  = process.env.BETTER_STACK_INGESTING_HOST
  ?? 'in.logs.betterstack.com'

const transport = (() => {
  if (isDev) {
    return {
      target:  'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    }
  }
  if (bsToken) {
    return {
      target:  '@logtail/pino',          // Better Stack transport
      options: { sourceToken: bsToken, options: { endpoint: `https://${bsHost}` } },
    }
  }
  return undefined
})()

export const logger: Logger = pino({
  level:    process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base:     { service: 'scooterhub', env: process.env.NODE_ENV ?? 'unknown' },
  redact:   {
    // Never log secrets or PII through any field.
    paths:  [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.body.password',
      'req.body.verification',
      'res.headers.cookie',
      '*.email',
      '*.phone',
      '*.recipient',
      '*.body',
    ],
    censor: '[REDACTED]',
  },
  transport,
})

/** Build a child logger bound to a request's correlation id. Cheap —
 *  pino's `child()` is essentially free at runtime. */
export function withCorrelation(
  correlationId: string,
  extras?: Record<string, unknown>,
): Logger {
  return logger.child({ correlationId, ...extras })
}
