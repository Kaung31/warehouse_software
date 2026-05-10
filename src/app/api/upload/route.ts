import { NextRequest } from 'next/server'
import { requireAuth, apiSuccess, apiError, withErrorHandler } from '@/lib/api-helpers'
import { r2 } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { enqueue } from '@/lib/queue'

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_SIZE      = 10 * 1024 * 1024 // 10 MB

const VALID_PHOTO_TYPES  = ['SCOOTER_INBOUND', 'SCOOTER_OUTBOUND', 'REPAIR_EVIDENCE', 'DAMAGE_REPORT']
const VALID_ENTITY_TYPES = ['Scooter', 'RepairOrder']

// Accepts multipart/form-data: the file goes server→R2, never browser→R2.
// This avoids all presigned-URL PUT issues (CORS, content-type mismatch, etc.)
export const POST = withErrorHandler(async (req: NextRequest) => {
  const user = await requireAuth('scooter:view')

  const formData   = await req.formData()
  const file       = formData.get('file')       as File   | null
  const photoType  = formData.get('photoType')  as string | null
  const entityType = formData.get('entityType') as string | null
  const entityId   = formData.get('entityId')   as string | null
  const caption    = formData.get('caption')    as string | null

  if (!file)       return apiError('No file provided', 400)
  if (!photoType  || !VALID_PHOTO_TYPES.includes(photoType))   return apiError('Invalid photoType', 400)
  if (!entityType || !VALID_ENTITY_TYPES.includes(entityType)) return apiError('Invalid entityType', 400)
  if (!entityId)   return apiError('entityId is required', 400)

  const contentType = file.type || 'image/jpeg'
  if (!ALLOWED_TYPES.includes(contentType)) return apiError('Only JPEG, PNG and WebP images are allowed', 400)
  if (file.size > MAX_SIZE)                 return apiError('File must be under 10 MB', 400)

  // Normalise extension — iOS sends image/heic, store as .jpg after R2 accepts it
  const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
            : contentType.includes('png')  ? 'png'
            : contentType.includes('webp') ? 'webp'
            : 'jpg'

  const key   = `photos/${entityType.toLowerCase()}/${entityId}/${randomUUID()}.${ext}`
  const bytes = await file.arrayBuffer()

  // Upload directly to R2 from the server — no presigned URL, no CORS issues
  await r2.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME!,
    Key:         key,
    Body:        Buffer.from(bytes),
    ContentType: contentType,
  }))

  const photo = await prisma.photo.create({
    data: {
      photoType:  photoType as never,
      entityType,
      entityId,
      s3Key:      key,
      caption:    caption || null,
      takenById:  user.id,
    },
  })

  // Phase 4 — fire-and-forget pre-warm of Cloudflare Images variants
  // so the first viewer doesn't pay the on-demand transform cost.
  // Cheap (one fetch per variant) and runs on the worker.
  await enqueue('process-case-photo', { photoId: photo.id })

  return apiSuccess({ key, photoId: photo.id })
})
