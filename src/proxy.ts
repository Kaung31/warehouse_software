import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/clerk(.*)',

  // ── Phase B: customer-facing tracking portal ─────────────────────────
  // The /track page and its detail subroute are intentionally
  // unauthenticated — customers don't have accounts. Access control is
  // a signed token (see lib/track-token.ts in Step 2) carried in the
  // ?token= query string. The /api/track/* endpoints validate that
  // token themselves, so middleware must let them through without
  // gating.
  '/track',
  '/track/(.*)',
  '/api/track/(.*)',

  // ── Production migration: liveness + deep health for uptime monitor ──
  // /api/health does external pings (DB/Redis/R2) and returns 200 / 503.
  // /api/ready is process-only and always 200.
  '/api/health',
  '/api/ready',

  // Resend + Twilio delivery webhooks. Both verify their own
  // signatures inside the handler so middleware can let them through.
  '/api/webhooks/resend(.*)',
  '/api/webhooks/twilio(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}