import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { verifyTrackToken } from '@/lib/track-token'
import { serializePublicTrack } from '@/lib/trackPublicSerializer'
import { CUSTOMER_STAGES } from '@/lib/customerStatusCopy'

/**
 * /track/[orderNumber]?token=...
 *
 * Public, unauthenticated. Server-side token verification + render.
 * If the token's invalid/expired/mismatched, we redirect back to /track
 * with ?expired=1 so the lookup form shows a friendly hint.
 *
 * Layout (mobile-first):
 *   1. Order summary
 *   2. 5-step progress pipeline
 *   3. Status sentence card
 *   4. Photo gallery (intake only)
 *   5. Tracking number (DISPATCHED/DELIVERED only)
 *   6. Timeline (collapsible)
 *   7. Footer with last-updated + refresh
 */

type Ctx = {
  params:       Promise<{ orderNumber: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function fmtShortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function fmtTimeShort(iso: string): string {
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${h}:${m}`
}

export default async function TrackDetailPage(ctx: Ctx) {
  const { orderNumber } = await ctx.params
  const sp              = await ctx.searchParams
  const token = typeof sp.token === 'string' ? sp.token : null

  if (!token) redirect('/track?expired=1')

  const payload = await verifyTrackToken(token)
  if (!payload) redirect('/track?expired=1')

  const repair = await prisma.repairOrder.findUnique({
    where:  { id: payload.orderId },
    select: { orderNumber: true, caseType: true },
  })
  if (!repair || repair.caseType !== 'WARRANTY' || repair.orderNumber !== orderNumber) {
    redirect('/track?expired=1')
  }

  const data = await serializePublicTrack(payload.orderId)
  if (!data) redirect('/track?expired=1')

  const currentStageIdx = data.isClosed
    ? -1
    : CUSTOMER_STAGES.findIndex((s) => s.key === data.customerStage)

  return (
    <div
      style={{
        maxWidth:      720,
        margin:        '0 auto',
        display:       'flex',
        flexDirection: 'column',
        gap:           16,
      }}
    >
      {/* ── Order summary ────────────────────────────────────────── */}
      <Card>
        <div
          style={{
            display:        'flex',
            alignItems:     'flex-start',
            justifyContent: 'space-between',
            gap:            12,
            flexWrap:       'wrap',
          }}
        >
          <div>
            <div className="eyebrow" style={{ color: 'var(--sub)', marginBottom: 4 }}>
              Order
            </div>
            <div
              className="mono"
              style={{
                fontSize:    20,
                fontWeight:  600,
                color:       'var(--text)',
                letterSpacing: '-0.01em',
              }}
            >
              {data.orderNumber}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', marginTop: 6 }}>
              {data.scooter.brand} {data.scooter.model}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="eyebrow" style={{ color: 'var(--sub)' }}>Estimated</div>
            <div
              style={{
                fontSize:    14,
                fontWeight:  500,
                color:       'var(--accent-text)',
                marginTop:   4,
              }}
            >
              {data.estimatedCompletion}
            </div>
            <div style={{ fontSize: 11, color: 'var(--sub)', marginTop: 2 }}>
              Repair started {fmtShortDate(data.startedAt)}
            </div>
          </div>
        </div>
      </Card>

      {/* ── Pipeline ─────────────────────────────────────────────── */}
      {data.isClosed ? (
        <Card>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Status</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
            {data.statusMessage}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--sub)' }}>
            Progress
          </div>
          <div
            role="list"
            style={{
              display:             'grid',
              gridTemplateColumns: `repeat(${CUSTOMER_STAGES.length}, 1fr)`,
              gap:                 0,
              alignItems:          'flex-start',
              position:            'relative',
            }}
          >
            {/* Connector line behind the dots */}
            <div
              aria-hidden
              style={{
                position:  'absolute',
                top:       11,
                left:      `calc(${100 / (CUSTOMER_STAGES.length * 2)}%)`,
                right:     `calc(${100 / (CUSTOMER_STAGES.length * 2)}%)`,
                height:    2,
                background:'var(--border)',
                zIndex:    0,
              }}
            />
            <div
              aria-hidden
              style={{
                position:  'absolute',
                top:       11,
                left:      `calc(${100 / (CUSTOMER_STAGES.length * 2)}%)`,
                width:     `${(currentStageIdx / (CUSTOMER_STAGES.length - 1)) * (100 - (100 / CUSTOMER_STAGES.length))}%`,
                height:    2,
                background:'var(--accent)',
                transition:'width .25s ease',
                zIndex:    1,
              }}
            />
            {CUSTOMER_STAGES.map((stage, i) => {
              const isDone     = i < currentStageIdx
              const isCurrent  = i === currentStageIdx
              return (
                <div
                  key={stage.key}
                  role="listitem"
                  style={{
                    display:        'flex',
                    flexDirection:  'column',
                    alignItems:     'center',
                    gap:            6,
                    position:       'relative',
                    zIndex:         2,
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      width:         24,
                      height:        24,
                      borderRadius:  '50%',
                      background:    isDone
                        ? 'var(--accent)'
                        : isCurrent
                          ? 'var(--accent)'
                          : 'var(--surface)',
                      border:        `2px solid ${isDone || isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                      display:       'flex',
                      alignItems:    'center',
                      justifyContent:'center',
                      boxShadow:     isCurrent ? '0 0 0 4px var(--accent-dim)' : 'none',
                      transition:    'all .2s ease',
                    }}
                  >
                    {isDone && <CheckMark />}
                  </div>
                  <div
                    style={{
                      fontSize:   11,
                      fontWeight: isCurrent ? 600 : 500,
                      color:      isCurrent ? 'var(--accent-text)' : isDone ? 'var(--text)' : 'var(--text-faint)',
                      textAlign:  'center',
                    }}
                  >
                    {stage.label}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Status sentence ──────────────────────────────────────── */}
      {!data.isClosed && (
        <Card>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Latest update</div>
          <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.55 }}>
            {data.statusMessage}
          </div>
        </Card>
      )}

      {/* ── Tracking number (DISPATCHED / DELIVERED) ─────────────── */}
      {data.trackingNumber && (
        <Card tone="accent">
          <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--accent-text)' }}>
            Delivery
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>
            {data.carrier ?? 'Carrier'}
          </div>
          <div
            className="mono"
            style={{
              fontSize:    14,
              fontWeight:  600,
              color:       'var(--text)',
              padding:     '8px 12px',
              background:  'var(--s2)',
              borderRadius:'var(--radius-md)',
              userSelect:  'all',
              wordBreak:   'break-all',
            }}
          >
            {data.trackingNumber}
          </div>
          {data.trackingUrl && (
            <a
              href={data.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize:    13,
                fontWeight:  500,
                color:       'var(--accent-text)',
                marginTop:   8,
                display:     'inline-flex',
                alignItems:  'center',
                gap:         4,
              }}
            >
              Track your delivery →
            </a>
          )}
        </Card>
      )}

      {/* ── Photos (intake only) ─────────────────────────────────── */}
      {data.intakePhotos.length > 0 && (
        <Card>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Arrival photos</div>
          <p style={{ fontSize: 12, color: 'var(--sub)', margin: '0 0 10px 0' }}>
            Here are the photos our team took when your scooter arrived.
          </p>
          <div
            style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap:                 8,
            }}
          >
            {data.intakePhotos.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:      'block',
                  aspectRatio:  '4 / 3',
                  borderRadius: 'var(--radius-md)',
                  overflow:     'hidden',
                  background:   'var(--s2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.caption ?? 'Arrival photo'}
                  style={{
                    width:      '100%',
                    height:     '100%',
                    objectFit:  'cover',
                    display:    'block',
                  }}
                />
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* ── Timeline (collapsible) ──────────────────────────────── */}
      {data.timeline.length > 0 && (
        <details
          style={{
            background:    'var(--surface)',
            border:        '1px solid var(--border)',
            borderRadius:  'var(--radius-lg)',
            boxShadow:     'var(--card-sh)',
            padding:       '14px 18px',
          }}
        >
          <summary
            style={{
              cursor:     'pointer',
              listStyle:  'none',
              fontSize:   13,
              fontWeight: 500,
              color:      'var(--accent-text)',
              padding:    0,
            }}
          >
            See repair history ({data.timeline.length})
          </summary>
          <ol
            style={{
              listStyle:    'none',
              padding:      0,
              margin:       '14px 0 0 0',
              display:      'flex',
              flexDirection:'column',
              gap:          10,
              borderTop:    '1px solid var(--border)',
              paddingTop:   12,
            }}
          >
            {data.timeline.map((ev, i) => (
              <li
                key={i}
                style={{
                  display:    'grid',
                  gridTemplateColumns: '8px 1fr auto',
                  gap:        12,
                  alignItems: 'baseline',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width:        8,
                    height:       8,
                    borderRadius: '50%',
                    background:   'var(--accent)',
                    marginTop:    6,
                  }}
                />
                <span style={{ fontSize: 13, color: 'var(--text)' }}>
                  {ev.message}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--sub)' }}
                >
                  {fmtTimeShort(ev.at)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {/* ── Footer ───────────────────────────────────────────────── */}
      <div
        style={{
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'center',
          gap:            10,
          fontSize:       11,
          color:          'var(--sub)',
          padding:        '4px 6px',
          flexWrap:       'wrap',
        }}
      >
        <span>Last updated {fmtTimeShort(data.fetchedAt)}</span>
        <Link
          href={`/track/${encodeURIComponent(data.orderNumber)}?token=${encodeURIComponent(token)}`}
          prefetch={false}
          style={{ color: 'var(--accent-text)', textDecoration: 'none' }}
        >
          Refresh ↻
        </Link>
      </div>
      <p
        style={{
          fontSize:   11,
          color:      'var(--text-faint)',
          textAlign:  'center',
          margin:     0,
          lineHeight: 1.5,
        }}
      >
        This page is private to you. Don&apos;t share the link.
      </p>
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function Card({
  children,
  tone,
}: {
  children: React.ReactNode
  tone?:    'accent'
}) {
  const isAccent = tone === 'accent'
  return (
    <div
      style={{
        background:    isAccent ? 'var(--accent-dim)' : 'var(--surface)',
        border:        '1px solid',
        borderColor:   isAccent ? 'transparent' : 'var(--border)',
        borderRadius:  'var(--radius-lg)',
        padding:       '16px 18px',
        boxShadow:     isAccent ? 'none' : 'var(--card-sh)',
      }}
    >
      {children}
    </div>
  )
}

function CheckMark() {
  return (
    <svg
      width={12} height={12} viewBox="0 0 24 24" fill="none"
      stroke="white" strokeWidth={3}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
