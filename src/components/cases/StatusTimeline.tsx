'use client'

import { useEffect, useState } from 'react'
import StatusBadge from '@/components/ui/StatusBadge'

/**
 * StatusTimeline — chronological list of status changes on a case.
 *
 * v2 changes (April 2026):
 *   • Status pills via central <StatusBadge>
 *   • From → To transitions with arrow when both states exist
 *   • Loopback events get red marker + "Looped back" tag
 *   • Time deltas between entries shown as small mono pills
 *   • Live-ticking last entry's relative time (refreshes every 60s)
 *   • Author avatars with role-based color
 *   • Empty state with icon
 *
 * Hydration fix in this revision:
 *   • formatStamp() previously used toLocaleString('en-GB', ...) which
 *     produces different output on Node server vs browser (server might
 *     output "22 Apr, 21:07" while client outputs "22 Apr at 21:07")
 *     causing a React hydration mismatch.
 *   • Now formats manually using fixed month names + numeric day/time.
 *     Output is locale-independent: "22 Apr 21:07".
 *   • The same date functions are used everywhere — server and client
 *     produce byte-identical strings.
 */

type HistoryEntry = {
  id: string
  fromStatus: string | null
  toStatus: string
  reason: string | null
  createdAt: string | Date
  changedBy: { name: string; role: string }
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN:     'var(--purple)',
  MANAGER:   'var(--blue)',
  CS:        'var(--amber)',
  WAREHOUSE: 'var(--green)',
  MECHANIC:  'var(--orange)',
  SYSTEM:    'var(--slate)',
}

const LOOPBACK_STATUSES = new Set([
  'QC_FAILED',
  'CS_RECHARGE',
  'DISPUTED',
  'CUSTOMER_DECLINED',
])

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Manually format a Date so server and client produce byte-identical
 * strings, avoiding the toLocaleString hydration mismatch.
 *
 * Format: "22 Apr 21:07"
 */
function formatStamp(d: Date): string {
  const day = d.getDate()
  const month = MONTHS[d.getMonth()]
  const hh = pad2(d.getHours())
  const mm = pad2(d.getMinutes())
  return `${day} ${month} ${hh}:${mm}`
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function relativeTime(d: Date, now: number): string {
  const diffMs = now - d.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  // Older than a week — use the same locale-free format as formatStamp
  return formatStamp(d)
}

function formatDelta(ms: number): string {
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return '< 1m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}


export default function StatusTimeline({
  history,
}: {
  history: HistoryEntry[]
}) {
  /* Live-ticking "now" — initialised to null on the server so the
   * first client render uses absolute timestamps too (matches SSR),
   * then on mount we flip to live-ticking relative time. */
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (history.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '24px 12px' }}>
        <div className="empty-state-icon" style={{ width: 40, height: 40 }}>
          <ClockIcon />
        </div>
        <div className="empty-state-title" style={{ fontSize: 13 }}>
          No history yet
        </div>
        <div className="empty-state-msg" style={{ fontSize: 12 }}>
          Status changes will appear here as the case moves through the
          pipeline.
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          left: 11,
          top: 14,
          bottom: 14,
          width: 1.5,
          background: 'var(--border)',
        }}
      />

      {history.map((entry, i) => {
        const isLast = i === history.length - 1
        const isFirst = i === 0
        const isLoopback = LOOPBACK_STATUSES.has(entry.toStatus)
        const date = new Date(entry.createdAt)
        const roleColor =
          ROLE_COLORS[entry.changedBy.role] ?? 'var(--slate)'

        const prevEntry = i > 0 ? history[i - 1] : null
        const delta = prevEntry
          ? date.getTime() - new Date(prevEntry.createdAt).getTime()
          : null

        const dotColor = isLoopback
          ? 'var(--red)'
          : isLast
          ? 'var(--accent)'
          : 'var(--green)'

        return (
          <div key={entry.id}>
            {delta != null && delta > 0 && (
              <div
                style={{
                  paddingLeft: 30,
                  marginBottom: 8,
                  marginTop: -4,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--text-faint)',
                    background: 'var(--s2)',
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <ArrowDownIcon />
                  {formatDelta(delta)}
                </span>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                gap: 12,
                marginBottom: isLast ? 0 : 12,
                position: 'relative',
                alignItems: 'flex-start',
              }}
            >
              {/* Marker dot */}
              <div
                style={{
                  width: 24,
                  height: 24,
                  minWidth: 24,
                  borderRadius: '50%',
                  background: 'var(--surface)',
                  border: `2px solid ${dotColor}`,
                  flexShrink: 0,
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  marginTop: 1,
                }}
              >
                {isLast ? (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: dotColor,
                      animation: 'plPulse 1.8s ease-in-out infinite',
                    }}
                  />
                ) : isLoopback ? (
                  <div
                    style={{ color: 'var(--red)', display: 'inline-flex' }}
                  >
                    <RefreshIcon />
                  </div>
                ) : (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: dotColor,
                    }}
                  />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                    marginBottom: 4,
                  }}
                >
                  {entry.fromStatus && !isFirst ? (
                    <>
                      <StatusBadge status={entry.fromStatus} />
                      <span
                        style={{
                          color: 'var(--text-faint)',
                          display: 'inline-flex',
                        }}
                      >
                        <ArrowRightIcon />
                      </span>
                      <StatusBadge status={entry.toStatus} />
                    </>
                  ) : (
                    <StatusBadge status={entry.toStatus} />
                  )}
                  {isLoopback && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: 'var(--red-text)',
                        background: 'var(--red-bg)',
                        padding: '1px 7px',
                        borderRadius: 999,
                        textTransform: 'uppercase',
                        letterSpacing: '.05em',
                      }}
                    >
                      Looped back
                    </span>
                  )}
                </div>

                {entry.reason && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text)',
                      marginTop: 4,
                      marginBottom: 4,
                      lineHeight: 1.5,
                      padding: '6px 10px',
                      background: 'var(--s2)',
                      borderRadius: 'var(--radius-md)',
                      borderLeft: `2px solid ${
                        isLoopback ? 'var(--red)' : 'var(--accent)'
                      }`,
                    }}
                  >
                    {entry.reason}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    fontSize: 11,
                    color: 'var(--text-faint)',
                  }}
                >
                  <span
                    className="av av-xs"
                    style={{ background: roleColor, fontSize: 9 }}
                    title={`${entry.changedBy.name} (${entry.changedBy.role})`}
                  >
                    {initialsOf(entry.changedBy.name)}
                  </span>
                  <span style={{ color: 'var(--sub)' }}>
                    {entry.changedBy.name}
                  </span>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <span
                    className="mono"
                    title={formatStamp(date)}
                    style={{ fontSize: 11 }}
                    suppressHydrationWarning
                  >
                    {/* On the server (and the very first client paint) we
                     * render the absolute timestamp so SSR HTML matches the
                     * client's first render exactly. After mount, the last
                     * entry switches to a live-ticking relative time. */}
                    {isLast && now != null
                      ? relativeTime(date, now)
                      : formatStamp(date)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

function ArrowRightIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="1 4 1 10 7 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}