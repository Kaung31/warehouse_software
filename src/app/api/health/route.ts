import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Redis } from '@upstash/redis'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'

/**
 * GET /api/health
 *
 * Deep health check used by uptime monitors (Better Stack) and the
 * Railway healthcheck. Pings every external dependency and reports
 * pass/fail + per-check latency in JSON.
 *
 * Returns:
 *   - 200 if every check passes
 *   - 503 if any check fails (Railway treats non-2xx as unhealthy)
 *
 * Each check has a 5-second timeout so a slow DB / cache / R2 doesn't
 * hang the whole endpoint.
 */

type CheckResult =
  | { ok: true;  ms: number }
  | { ok: false; ms: number; error: string }

async function timed(
  name:    string,
  fn:      () => Promise<unknown>,
  timeoutMs = 5_000,
): Promise<CheckResult> {
  const start = Date.now()
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${name} check timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ])
    return { ok: true, ms: Date.now() - start }
  } catch (err) {
    return {
      ok:    false,
      ms:    Date.now() - start,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}

let _r2: S3Client | null = null
function r2(): S3Client | null {
  if (_r2) return _r2
  const accountId       = process.env.R2_ACCOUNT_ID
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) return null
  _r2 = new S3Client({
    region:      'auto',
    endpoint:    `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return _r2
}

export async function GET() {
  const checks: Record<string, CheckResult> = {}

  // Postgres
  checks.db = await timed('db', () => prisma.$queryRaw`SELECT 1`)

  // Upstash — skipped if not configured (flagged but doesn't fail
  // overall, so dev environments without Upstash still report healthy).
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    checks.redis = await timed('redis', async () => {
      const r = Redis.fromEnv()
      await r.ping()
    })
  }

  // R2 — HEAD bucket. Skipped if no creds.
  const r2Bucket = process.env.R2_BUCKET_NAME
  if (r2Bucket && r2()) {
    checks.r2 = await timed('r2', async () => {
      await r2()!.send(new HeadBucketCommand({ Bucket: r2Bucket }))
    })
  }

  const allOk = Object.values(checks).every((c) => c.ok)
  return NextResponse.json(
    {
      status:      allOk ? 'healthy' : 'degraded',
      timestamp:   new Date().toISOString(),
      release:     process.env.SENTRY_RELEASE ?? 'unknown',
      environment: process.env.NODE_ENV,
      checks,
    },
    { status: allOk ? 200 : 503 },
  )
}
