import type { CapturedPhoto } from '@/components/ui/PhotoCapture'

type PhotoType  = 'SCOOTER_INBOUND' | 'SCOOTER_OUTBOUND' | 'REPAIR_EVIDENCE' | 'DAMAGE_REPORT'
type EntityType = 'RepairOrder' | 'Scooter'

/**
 * Uploads locally-captured photos to R2 via server-side POST (multipart/form-data).
 * The file goes browser → Next.js server → R2 — avoids all presigned-URL / CORS issues.
 * Errors are surfaced via the returned array of failure messages so the UI can show them.
 */
export async function uploadPhotos(
  photos:     CapturedPhoto[],
  entityId:   string,
  entityType: EntityType,
  photoType:  PhotoType,
): Promise<string[]> {
  const errors: string[] = []

  for (const photo of photos) {
    try {
      const form = new FormData()
      form.append('file',       photo.file)
      form.append('photoType',  photoType)
      form.append('entityType', entityType)
      form.append('entityId',   entityId)

      const res = await fetch('/api/upload', { method: 'POST', body: form })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        errors.push(body.error ?? `Failed to upload ${photo.name}`)
      }
    } catch (err) {
      errors.push(`Upload error for ${photo.name}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  return errors
}
