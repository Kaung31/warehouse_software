/**
 * Trigger.dev task — `process-case-photo`.
 *
 * Fired after a case photo lands in R2. Pre-warms the Cloudflare
 * Images Transformations cache by hitting the `thumb` and `medium`
 * variants once each — so the first user to actually load the case
 * gets sub-100 ms images instead of a 1-second on-demand transform.
 *
 * Inputs:
 *   - photoId: the CasePhoto.id (or `Photo.id` — the polymorphic
 *              table). We re-load to get the s3Key.
 *
 * Best-effort: if the warm fails (transient Cloudflare error), the
 * task retries; after `maxAttempts` we log and give up. The first
 * real user to view the photo will pay a one-time transform cost
 * that's still <1 s.
 */

import { logger, task } from '@trigger.dev/sdk/v3'
import { prisma } from '@/lib/prisma'
import { getThumbUrl } from '@/lib/r2'

export const processCasePhoto = task({
  id:          'process-case-photo',
  maxDuration: 60,
  run: async (payload: { photoId: string }) => {
    logger.info('process-case-photo start', payload)

    const photo = await prisma.photo.findUnique({
      where:  { id: payload.photoId },
      select: { s3Key: true },
    })
    if (!photo) {
      logger.warn('process-case-photo: photo not found', payload)
      return { warmed: 0 }
    }

    let warmed = 0
    for (const variant of ['thumb', 'medium'] as const) {
      const url = getThumbUrl(photo.s3Key, variant)
      if (!url) {
        logger.warn('process-case-photo: no transform URL — Cloudflare Images host not configured')
        continue
      }
      try {
        // GET, not HEAD — Cloudflare needs to actually generate the
        // variant on first hit, which it only does on a body-returning
        // request. Discard the body, we only care about the warming.
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) warmed++
        else logger.warn('process-case-photo: warm failed', { variant, status: res.status })
      } catch (err) {
        logger.warn('process-case-photo: warm errored', { variant, err: String(err) })
      }
    }

    logger.info('process-case-photo done', { warmed, photoId: payload.photoId })
    return { warmed }
  },
})
