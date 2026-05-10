import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const r2 = new S3Client({
  region:         'auto',
  endpoint:       `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true, // <--- critical fix for Cloudflare R2
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

/* ─── Pre-signed direct uploads (browser → R2) ─────────────────────── */

// Generates a pre-signed URL the browser uploads directly to R2
// The file never passes through your server — much faster and safer
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME!,
    Key:         key,
    ContentType: contentType,
  })
  // URL expires in 5 minutes — enough for an upload
  return getSignedUrl(r2, command, { expiresIn: 300 })
}

/* ─── Read URLs ──────────────────────────────────────────────────────
 *
 * Phase 4: routes through Cloudflare Images Transformations when
 * `CLOUDFLARE_IMAGES_HOST` is configured. The original presigned-URL
 * fallback stays in place for dev / when the host isn't set up yet.
 *
 * Variants:
 *   - 'thumb'  → 200 × 200, format=auto (AVIF/WebP/JPEG)
 *   - 'medium' → 800 × 800, format=auto
 *   - 'full'   → original (no transform; routed straight to R2)
 *
 * The `getViewUrl()` helper (existing call sites) stays around with
 * the same shape but now returns a Cloudflare-transformed URL when
 * possible — so we don't have to touch every consumer in this PR.
 * Default variant is 'medium' (800px) which covers ~all UI use cases
 * and is still cheap on the wire (~30 KB AVIF vs. 4 MB original).
 */

export type PhotoVariant = 'thumb' | 'medium' | 'full'

const VARIANT_PARAMS: Record<Exclude<PhotoVariant, 'full'>, string> = {
  thumb:  'width=200,height=200,fit=cover,quality=85,format=auto',
  medium: 'width=800,height=800,fit=scale-down,quality=85,format=auto',
}

/** Build a Cloudflare Images Transformations URL routed at the R2
 *  presigned origin URL. Returns null when CLOUDFLARE_IMAGES_HOST
 *  isn't configured — caller should fall back to a plain presigned. */
export function buildTransformUrl(
  presignedOrigin: string,
  variant: Exclude<PhotoVariant, 'full'>,
): string | null {
  const host = process.env.CLOUDFLARE_IMAGES_HOST
  if (!host) return null
  const params = VARIANT_PARAMS[variant]
  // Cloudflare's transform syntax: /cdn-cgi/image/<params>/<source-url>
  // We URL-encode the origin so the path doesn't break with double-slashes.
  return `${host.replace(/\/$/, '')}/cdn-cgi/image/${params}/${encodeURIComponent(presignedOrigin)}`
}

/**
 * Returns a viewable URL for a private R2 object.
 *
 * Backwards-compatible: existing callers don't pass `variant`,
 * they get the `medium` (800 px AVIF/WebP) variant when Cloudflare
 * Images is configured, otherwise the raw presigned URL — same as
 * before this change.
 */
export async function getViewUrl(
  key:     string,
  variant: PhotoVariant = 'medium',
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key:    key,
  })
  const presigned = await getSignedUrl(r2, command, { expiresIn: 3600 })

  if (variant === 'full') return presigned
  return buildTransformUrl(presigned, variant) ?? presigned
}

/**
 * Synchronous helper used by the Trigger.dev pre-warm task. Doesn't
 * require a presigned URL because Cloudflare Images can fetch from
 * the public-facing presigned origin we'd build later — for the
 * pre-warm we just generate the transform URL pointed at the R2
 * public URL when configured.
 *
 * Returns null when CLOUDFLARE_IMAGES_HOST isn't set up.
 */
export function getThumbUrl(
  s3Key:   string,
  variant: Exclude<PhotoVariant, 'full'> = 'thumb',
): string | null {
  const host    = process.env.CLOUDFLARE_IMAGES_HOST
  const r2Pub   = process.env.R2_PUBLIC_URL
  if (!host || !r2Pub) return null
  const origin  = `${r2Pub.replace(/\/$/, '')}/${encodeURIComponent(s3Key)}`
  const params  = VARIANT_PARAMS[variant]
  return `${host.replace(/\/$/, '')}/cdn-cgi/image/${params}/${encodeURIComponent(origin)}`
}

/* ─── Validation ─────────────────────────────────────────────────── */

const ALLOWED_TYPES   = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_BYTES  = 10 * 1024 * 1024 // 10MB

export function validateFileUpload(contentType: string, sizeBytes: number): string | null {
  if (!ALLOWED_TYPES.includes(contentType)) return 'Only JPEG, PNG and WebP images are allowed'
  if (sizeBytes > MAX_SIZE_BYTES) return 'File must be under 10MB'
  return null
}
