'use client'
import { useRef } from 'react'

export type CapturedPhoto = {
  preview: string
  file:    File
  name:    string
}

type Props = {
  label:        string
  photos:       CapturedPhoto[]
  onChange:     (photos: CapturedPhoto[]) => void
  maxPhotos?:   number
  required?:    boolean
  samplePhotos?: { url: string; caption: string }[]
}

export default function PhotoCapture({
  label,
  photos,
  onChange,
  maxPhotos = 5,
  required,
  samplePhotos,
}: Props) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  function handleFiles(files: FileList | null) {
    if (!files) return
    const remaining = maxPhotos - photos.length
    const toProcess = Array.from(files).slice(0, remaining)

    toProcess.forEach(file => {
      const reader = new FileReader()
      reader.onload = e => {
        const preview = e.target?.result as string
        onChange([...photos, { preview, file, name: file.name }])
      }
      reader.readAsDataURL(file)
    })
  }

  function remove(idx: number) {
    onChange(photos.filter((_, i) => i !== idx))
  }

  const canAdd = photos.length < maxPhotos
  const showSamples = photos.length === 0 && samplePhotos && samplePhotos.length > 0

  return (
    <div>
      <label style={{
        fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
        display: 'block', marginBottom: 8,
      }}>
        {label}
        {required && <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>}
      </label>

      {/* Photo grid — real uploads + sample placeholders */}
      {(photos.length > 0 || showSamples) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={p.preview}
                alt={p.name}
                style={{
                  width: 90, height: 90, objectFit: 'cover',
                  borderRadius: 'var(--radius)',
                  border: '2px solid var(--border-focus)',
                  display: 'block',
                }}
              />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.55)', borderRadius: '0 0 var(--radius) var(--radius)',
                padding: '3px 5px', fontSize: 9, color: '#fff',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {p.name}
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                style={{
                  position: 'absolute', top: -7, right: -7,
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--red)', color: '#fff',
                  border: '2px solid var(--bg)',
                  cursor: 'pointer', fontSize: 12, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                ×
              </button>
            </div>
          ))}

          {/* Sample demo photos — shown only when no real photos yet */}
          {showSamples && samplePhotos!.map((s, i) => (
            <div key={`demo-${i}`} style={{ position: 'relative', opacity: 0.45 }}>
              <img
                src={s.url}
                alt={s.caption}
                style={{
                  width: 90, height: 90, objectFit: 'cover',
                  borderRadius: 'var(--radius)',
                  border: '2px dashed var(--border)',
                  display: 'block',
                  filter: 'grayscale(30%)',
                }}
              />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.65)', borderRadius: '0 0 var(--radius) var(--radius)',
                padding: '3px 5px', fontSize: 9, color: '#ccc',
                textAlign: 'center',
              }}>
                {s.caption}
              </div>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.35)', borderRadius: 'var(--radius) var(--radius) 0 0',
                padding: '3px', fontSize: 8, color: '#fff', textAlign: 'center',
                fontWeight: 600, letterSpacing: '0.05em',
              }}>
                SAMPLE
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no photos, no samples */}
      {photos.length === 0 && !showSamples && (
        <div style={{
          padding: '16px', border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)', textAlign: 'center',
          color: 'var(--text-faint)', fontSize: 12, marginBottom: 10,
          background: 'var(--bg-raised)',
        }}>
          No photos yet — upload or take a photo below
        </div>
      )}

      {/* Upload / Camera buttons */}
      {canAdd && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={uploadRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          />
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            style={{
              padding: '7px 14px', fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              background: 'var(--bg-raised)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.1s',
            }}
          >
            📎 Upload photo
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            style={{
              padding: '7px 14px', fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              background: 'var(--bg-raised)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.1s',
            }}
          >
            📷 Take photo
          </button>
          {photos.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-faint)', alignSelf: 'center' }}>
              {photos.length}/{maxPhotos} photos
            </span>
          )}
        </div>
      )}
      {!canAdd && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
          Maximum {maxPhotos} photos reached
        </div>
      )}
    </div>
  )
}
