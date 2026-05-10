'use client'
import { useState } from 'react'

type Photo = {
  id:        string
  photoType: string
  viewUrl:   string
  caption?:  string | null
  createdAt: Date | string
}

type Props = {
  photos: Photo[]
  title?: string
}

const typeLabels: Record<string, string> = {
  SCOOTER_INBOUND:  'Inbound',
  SCOOTER_OUTBOUND: 'QC / Outbound',
  REPAIR_EVIDENCE:  'Repair',
  DAMAGE_REPORT:    'CS Evidence',
  QC_PHOTO:         'QC',
  CS_EVIDENCE:      'CS Evidence',
}

const typeColors: Record<string, string> = {
  SCOOTER_INBOUND:  '#0969da',
  SCOOTER_OUTBOUND: '#1a7f37',
  REPAIR_EVIDENCE:  '#8250df',
  DAMAGE_REPORT:    '#d1242f',
  QC_PHOTO:         '#1a7f37',
  CS_EVIDENCE:      '#9a6700',
}

export default function PhotoGallery({ photos, title = 'Photos' }: Props) {
  const [selected,   setSelected]   = useState<Photo | null>(null)
  const [activeType, setActiveType] = useState<string>('ALL')

  if (photos.length === 0) {
    return (
      <div style={{
        background:   'var(--bg-surface)',
        border:       '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding:      '16px',
      }}>
        <div style={{
          fontSize:      12,
          fontWeight:    600,
          color:         'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom:  12,
        }}>
          {title}
        </div>
        <div style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          padding:        '24px 0',
          color:          'var(--text-faint)',
          gap:            6,
        }}>
          <div style={{ fontSize: 24, opacity: 0.4 }}>◻</div>
          <div style={{ fontSize: 12 }}>No photos uploaded yet</div>
        </div>
      </div>
    )
  }

  const types    = ['ALL', ...Array.from(new Set(photos.map(p => p.photoType)))]
  const filtered = activeType === 'ALL'
    ? photos
    : photos.filter(p => p.photoType === activeType)

  return (
    <>
      <div style={{
        background:   'var(--bg-surface)',
        border:       '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow:     'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding:      '12px 14px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{
            fontSize:      12,
            fontWeight:    600,
            color:         'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {title} ({photos.length})
          </span>
        </div>

        {/* Type filter — only show if more than one type exists */}
        {types.length > 2 && (
          <div style={{
            display:      'flex',
            gap:          4,
            padding:      '8px 10px',
            borderBottom: '1px solid var(--border)',
            flexWrap:     'wrap',
          }}>
            {types.map(t => (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                style={{
                  padding:      '3px 9px',
                  fontSize:     11,
                  fontWeight:   activeType === t ? 500 : 400,
                  background:   activeType === t ? 'var(--bg-raised)' : 'transparent',
                  border:       `1px solid ${activeType === t ? 'var(--border-focus)' : 'var(--border)'}`,
                  borderRadius: 20,
                  color:        activeType === t ? 'var(--accent)' : 'var(--text-muted)',
                  cursor:       'pointer',
                  fontFamily:   'var(--font-sans)',
                  whiteSpace:   'nowrap',
                }}
              >
                {t === 'ALL' ? 'All' : (typeLabels[t] ?? t)}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
          gap:                 6,
          padding:             10,
        }}>
          {filtered.map(photo => (
            <div
              key={photo.id}
              onClick={() => setSelected(photo)}
              style={{
                aspectRatio:  '1',
                borderRadius: 'var(--radius)',
                overflow:     'hidden',
                cursor:       'pointer',
                border:       '1px solid var(--border)',
                position:     'relative',
                background:   'var(--bg-raised)',
                transition:   'border-color 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <img
                src={photo.viewUrl}
                alt={photo.caption ?? photo.photoType}
                style={{
                  width:     '100%',
                  height:    '100%',
                  objectFit: 'cover',
                  display:   'block',
                }}
                onError={e => {
                  const el = e.target as HTMLImageElement
                  el.style.display = 'none'
                  const parent = el.parentElement
                  if (parent) {
                    parent.style.display         = 'flex'
                    parent.style.alignItems      = 'center'
                    parent.style.justifyContent  = 'center'
                    parent.style.fontSize        = '20px'
                    parent.style.color           = 'var(--text-faint)'
                    parent.innerText             = '◻'
                  }
                }}
              />
              {/* Type label overlay */}
              <div style={{
                position:      'absolute',
                bottom:        3,
                left:          3,
                fontSize:      9,
                fontWeight:    600,
                padding:       '2px 5px',
                borderRadius:  3,
                background:    typeColors[photo.photoType] ?? '#1a1a2e',
                color:         '#fff',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                lineHeight:    1.3,
              }}>
                {typeLabels[photo.photoType] ?? photo.photoType}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position:       'fixed',
            inset:          0,
            background:     'rgba(0,0,0,0.92)',
            zIndex:         9999,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexDirection:  'column',
            gap:            14,
            padding:        24,
          }}
        >
          {/* Close hint */}
          <div style={{
            position: 'absolute',
            top:      20,
            right:    24,
            fontSize: 12,
            color:    '#555',
          }}>
            ✕ click anywhere to close
          </div>

          <img
            src={selected.viewUrl}
            alt={selected.caption ?? ''}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth:     '90vw',
              maxHeight:    '78vh',
              objectFit:    'contain',
              borderRadius: 8,
              border:       '1px solid #333',
            }}
          />

          {/* Meta */}
          <div style={{
            display:       'flex',
            flexDirection: 'column',
            alignItems:    'center',
            gap:           6,
          }}>
            <span style={{
              fontSize:      10,
              fontWeight:    600,
              padding:       '3px 10px',
              borderRadius:  20,
              background:    typeColors[selected.photoType] ?? '#1a1a2e',
              color:         '#fff',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              {typeLabels[selected.photoType] ?? selected.photoType}
            </span>
            {selected.caption && (
              <span style={{ fontSize: 13, color: '#ccc' }}>{selected.caption}</span>
            )}
            <span style={{ fontSize: 11, color: '#555' }}>
              {new Date(selected.createdAt).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        </div>
      )}
    </>
  )
}