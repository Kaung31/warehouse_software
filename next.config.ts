import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const isDev = process.env.NODE_ENV === 'development'

const nextConfig: NextConfig = {
  // Standalone output for Railway — copies only what's needed at runtime
  // into .next/standalone, ~80% smaller container image.
  output: 'standalone',

  // Prisma needs to stay external (its query engine is a binary).
  serverExternalPackages: ['@prisma/client', 'prisma'],

  // Cloudflare Images Transformations URL handling.
  images: {
    remotePatterns: [
      // R2 origin (presigned URLs from getViewUrl).
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      // Cloudflare Images Transformations served from your zone.
      { protocol: 'https', hostname: '*.scooterhub.co.uk' },
    ],
    // We're using Cloudflare's transformer — disable Next's own image
    // optimisation so we don't double-process.
    unoptimized: true,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',         value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
          {
            key:   'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key:   'Content-Security-Policy',
            value: [
              "default-src 'self'",
              isDev
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.accounts.dev https://cdn.jsdelivr.net https://*.posthog.com https://*.pusher.com"
                : "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://cdn.jsdelivr.net https://*.posthog.com https://*.pusher.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // R2 + Cloudflare Images need https; data: for inline SVGs.
              "img-src 'self' data: blob: https:",
              "worker-src 'self' blob:",
              [
                "connect-src 'self'",
                'https://*.clerk.accounts.dev https://api.clerk.dev https://clerk.scooterhub.co.uk',
                'wss://*.clerk.accounts.dev',
                'https://*.posthog.com',
                'https://*.upstash.io',
                'https://*.sentry.io',
                'https://*.pusher.com wss://*.pusher.com',
                'https://*.trigger.dev',
              ].join(' '),
              "frame-src 'self' https://*.clerk.accounts.dev https://accounts.google.com",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

/** Sentry build-time config — uploads source maps when the
 *  SENTRY_AUTH_TOKEN env var is set in CI. Safe locally without the
 *  token: source-map upload is skipped silently. */
export default withSentryConfig(nextConfig, {
  org:    process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Upload only on production builds with a token present.
  silent:               !process.env.CI,
  authToken:            process.env.SENTRY_AUTH_TOKEN,
  disableLogger:        true,
  widenClientFileUpload: true,
  // Sentry 10.x replaced top-level `hideSourceMaps: true` with the
  // nested `sourcemaps.deleteSourcemapsAfterUpload: true` flag — same
  // intent: ship maps to Sentry, then delete them from the build
  // output so they're not served publicly.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
})
