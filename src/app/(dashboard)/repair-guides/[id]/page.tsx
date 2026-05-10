import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import Btn from '@/components/ui/Btn'

/**
 * /repair-guides/[id] — viewer for a single RepairGuide.
 *
 * Phase A v2: simple model-specific how-to pages the mechanic consults
 * from /workshop/job/[jobId]. The guide picker on the job page links
 * here with `?return=/workshop/job/<id>`, and the back button below
 * sends the mechanic straight back to their job.
 *
 * The body is markdown. We use a tiny, dependency-free renderer so
 * we don't pull a markdown library into the bundle for content that's
 * still a placeholder dataset.
 */

type Ctx = {
  params:       Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function RepairGuidePage(ctx: Ctx) {
  const { id }     = await ctx.params
  const sp         = await ctx.searchParams
  const returnTo   = typeof sp.return === 'string' ? sp.return : null

  const guide = await prisma.repairGuide.findUnique({ where: { id } })
  if (!guide) notFound()

  // Validate the return target — only allow same-origin paths so the
  // back button can't be coerced into open-redirecting somewhere.
  const safeReturn =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : null

  return (
    <div
      className="fade-up"
      style={{
        display:       'flex',
        flexDirection: 'column',
        gap:           14,
        maxWidth:      820,
        margin:        '0 auto',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            12,
          flexWrap:       'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="eyebrow" style={{ color: 'var(--sub)' }}>
            Repair guide
          </div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            {guide.title}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--sub)' }}>
            For{' '}
            <span className="mono" style={{ color: 'var(--text)' }}>
              {guide.brand ? `${guide.brand} ` : ''}{guide.scooterModel}
            </span>
            {guide.category && (
              <>
                {' · '}
                <span
                  style={{
                    fontSize:      10,
                    fontWeight:    600,
                    textTransform: 'uppercase',
                    letterSpacing: '.06em',
                    padding:       '2px 7px',
                    borderRadius:  999,
                    background:    'var(--accent-dim)',
                    color:         'var(--accent-text)',
                  }}
                >
                  {guide.category}
                </span>
              </>
            )}
          </div>
        </div>
        {safeReturn && (
          <Link href={safeReturn}>
            <Btn variant="secondary" iconLeft={<BackIcon />}>
              Back to job
            </Btn>
          </Link>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          background:    'var(--surface)',
          border:        '1px solid var(--border)',
          borderRadius:  'var(--radius-lg)',
          padding:       '22px 26px',
          boxShadow:     'var(--card-sh)',
        }}
      >
        <Markdown source={guide.body} />
      </div>

      {/* Bottom Back to job — handy after long scroll */}
      {safeReturn && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Link href={safeReturn}>
            <Btn variant="primary" iconLeft={<BackIcon />}>
              Back to job
            </Btn>
          </Link>
        </div>
      )}
    </div>
  )
}

/* ─── Tiny markdown renderer ──────────────────────────────────────────
 * Supports just what the seed dataset uses:
 *   - # / ## headings
 *   - **bold**
 *   - 1. ordered lists
 *   - > blockquote
 *   - blank lines as paragraph breaks
 * Anything else falls through as a paragraph. */

function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  type Block =
    | { kind: 'h1' | 'h2'; text: string }
    | { kind: 'p';  text: string }
    | { kind: 'ol'; items: string[] }
    | { kind: 'quote'; text: string }

  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Skip blank lines
    if (line.trim() === '') { i++; continue }

    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: line.slice(3).trim() })
      i++; continue
    }
    if (line.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: line.slice(2).trim() })
      i++; continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim())
        i++
      }
      blocks.push({ kind: 'ol', items })
      continue
    }
    if (line.startsWith('> ')) {
      blocks.push({ kind: 'quote', text: line.slice(2).trim() })
      i++; continue
    }
    // Paragraph — accumulate consecutive non-empty lines.
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('>') &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'p', text: para.join(' ') })
  }

  return (
    <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text)' }}>
      {blocks.map((b, idx) => {
        switch (b.kind) {
          case 'h1':
            return (
              <h1
                key={idx}
                style={{
                  fontSize:    20,
                  fontWeight:  600,
                  marginTop:   idx === 0 ? 0 : 18,
                  marginBottom:8,
                  letterSpacing:'-0.01em',
                }}
              >
                <Inline source={b.text} />
              </h1>
            )
          case 'h2':
            return (
              <h2
                key={idx}
                style={{
                  fontSize:   16,
                  fontWeight: 600,
                  marginTop:  16,
                  marginBottom:6,
                }}
              >
                <Inline source={b.text} />
              </h2>
            )
          case 'p':
            return (
              <p key={idx} style={{ margin: '0 0 12px 0' }}>
                <Inline source={b.text} />
              </p>
            )
          case 'ol':
            return (
              <ol
                key={idx}
                style={{
                  margin:      '0 0 12px 0',
                  paddingLeft: 22,
                  display:     'flex',
                  flexDirection:'column',
                  gap:         6,
                }}
              >
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline source={it} />
                  </li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <blockquote
                key={idx}
                style={{
                  margin:        '0 0 12px 0',
                  padding:       '10px 14px',
                  borderLeft:    '3px solid var(--accent)',
                  background:    'var(--accent-dim)',
                  borderRadius:  '0 var(--radius-md) var(--radius-md) 0',
                  fontSize:      13,
                  color:         'var(--accent-text)',
                }}
              >
                <Inline source={b.text} />
              </blockquote>
            )
        }
      })}
    </div>
  )
}

/** Inline formatting — handles **bold** only (the seed content uses
 *  nothing else). Plain text otherwise. */
function Inline({ source }: { source: string }) {
  const parts: React.ReactNode[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) parts.push(source.slice(last, m.index))
    parts.push(<strong key={m.index}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < source.length) parts.push(source.slice(last))
  return <>{parts}</>
}

function BackIcon() {
  return (
    <svg
      width={14} height={14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
