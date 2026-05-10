/**
 * Next.js instrumentation hook.
 *
 * Runs once per server / edge runtime cold start. We use it to load the
 * Sentry SDK with the right runtime config — Sentry's Node SDK and
 * Edge SDK are different builds and we'd otherwise need separate
 * conditional imports in app code.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

/** Forwards request errors to Sentry. Wired automatically by Next 15+
 *  when this file exists at the conventional path. */
export { captureRequestError as onRequestError } from '@sentry/nextjs'
