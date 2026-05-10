import { NextResponse } from 'next/server'

/**
 * GET /api/ready
 *
 * Cheap liveness probe — does NOT touch any external dependency. Used
 * by orchestrators (Railway / Kubernetes) to decide whether the
 * process is up at all. Use /api/health for "is the system actually
 * working".
 *
 * Always 200 unless the process itself is broken.
 */
export function GET() {
  return NextResponse.json({ status: 'ok', uptimeMs: Math.round(process.uptime() * 1000) })
}
