import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { getViewUrl } from '@/lib/r2'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/cases/[id]/photos
 *
 * Phase 4 — returns three variant URLs per photo so the client can
 * render `thumb` in the grid, swap to `medium` on expand, and link
 * the `full` original behind a "view raw" tap. All three are signed
 * with a 1-hour TTL.
 */
export const GET = withErrorHandler(async (_req: NextRequest, ctx: unknown) => {
  await requireAuth('case:view')
  const { id } = await (ctx as Ctx).params

  const exists = await prisma.repairOrder.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return apiError('Case not found', 404)

  const photos = await prisma.photo.findMany({
    where:   { entityType: 'RepairOrder', entityId: id },
    orderBy: { createdAt: 'asc' },
  })

  // Generate the three variant URLs in parallel — Cloudflare's
  // transformer does the heavy lifting, we just construct URLs.
  const withUrls = await Promise.all(
    photos.map(async (p) => {
      try {
        const [thumb, medium, full] = await Promise.all([
          getViewUrl(p.s3Key, 'thumb'),
          getViewUrl(p.s3Key, 'medium'),
          getViewUrl(p.s3Key, 'full'),
        ])
        return {
          id:        p.id,
          photoType: p.photoType,
          caption:   p.caption,
          createdAt: p.createdAt,
          // Backwards-compat: the existing CasePhotos client component
          // reads `viewUrl`. Keep it pointing at `medium` (best-balance
          // default).
          viewUrl:   medium,
          urls: { thumb, medium, full },
        }
      } catch {
        return null
      }
    }),
  )

  return apiSuccess(withUrls.filter(Boolean))
})
