'use client'

import { useEffect, useState } from 'react'

/**
 * JobTimer — pause/resume timer card for the mechanic.
 *
 * Auto-starts on mount (using `repairStartedAt` from the server as the
 * initial accumulated time). Mechanic can stop the visible timer for a
 * break (toilet, lunch, parts hunt) and resume; the display freezes
 * while paused.
 *
 * State model:
 *   - `accumulatedMs` is total active time when the timer was last paused.
 *   - `runningSince`  is `Date.now()` of the last resume; null while paused.
 *   - When running, `display = accumulatedMs + (now - runningSince)`.
 *   - When paused,  `display = accumulatedMs`.
 *
 * The pause/resume state is persisted to localStorage keyed by case id
 * so a refresh doesn't lose where you were. This is purely a visual
 * helper — the server-side `RepairTimeLog.startedAt` / `completedAt`
 * are unchanged. Total case duration on QC submission is still based
 * on the server timestamps, not this widget.
 */

type Props = {
  caseId:          string
  /** ISO. The original server start (or null = never started). */
  repairStartedAt: string | null
}

type Persisted = {
  accumulatedMs:    number
  runningSinceMs:   number | null
}

const LS_PREFIX = 'sh_jobtimer_'

function load(caseId: string): Persisted | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + caseId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (
      typeof parsed.accumulatedMs === 'number' &&
      (parsed.runningSinceMs === null || typeof parsed.runningSinceMs === 'number')
    ) {
      return parsed
    }
  } catch {
    /* fall through */
  }
  return null
}

function save(caseId: string, p: Persisted) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_PREFIX + caseId, JSON.stringify(p))
  } catch {
    /* ignore quota errors */
  }
}

function fmtClock(totalMs: number): string {
  const total = Math.max(0, Math.floor(totalMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export default function JobTimer({ caseId, repairStartedAt }: Props) {
  /* On first render, seed from localStorage if we have it; otherwise
   * derive from the server start. We do this entirely in useState
   * initializers (which only run on mount) to avoid the React 19
   * lint rule against synchronous setState in effects. */
  const [accumulatedMs,  setAccumulatedMs]  = useState<number>(() => {
    const saved = load(caseId)
    if (saved) return saved.accumulatedMs
    if (repairStartedAt) {
      return Math.max(0, Date.now() - new Date(repairStartedAt).getTime())
    }
    return 0
  })

  const [runningSinceMs, setRunningSinceMs] = useState<number | null>(() => {
    const saved = load(caseId)
    if (saved) return saved.runningSinceMs
    return Date.now()
  })

  const [now, setNow] = useState(() => Date.now())

  /* Tick every second while running. Pausing clears the interval via
   * the dependency on `runningSinceMs`. */
  useEffect(() => {
    if (runningSinceMs === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runningSinceMs])

  /* The persisted state only changes via the three click handlers below.
   * Saving from inside each handler avoids the lint rules around touching
   * refs during render or calling setState in an effect — the canonical
   * "event handler is the right place" pattern. */

  const isRunning = runningSinceMs !== null
  const displayMs = isRunning
    ? accumulatedMs + (now - runningSinceMs)
    : accumulatedMs

  function pause() {
    if (runningSinceMs === null) return
    const slice    = Date.now() - runningSinceMs
    const nextAcc  = accumulatedMs + slice
    setAccumulatedMs(nextAcc)
    setRunningSinceMs(null)
    save(caseId, { accumulatedMs: nextAcc, runningSinceMs: null })
  }

  function resume() {
    if (runningSinceMs !== null) return
    const t = Date.now()
    setRunningSinceMs(t)
    save(caseId, { accumulatedMs, runningSinceMs: t })
  }

  function reset() {
    if (!window.confirm('Reset the visible timer to 0:00:00? (Server-side case start time is not affected.)')) return
    const t = Date.now()
    setAccumulatedMs(0)
    setRunningSinceMs(t)
    save(caseId, { accumulatedMs: 0, runningSinceMs: t })
  }

  return (
    <div
      style={{
        background:    'var(--surface)',
        border:        '1px solid var(--border)',
        borderRadius:  'var(--radius-lg)',
        padding:       '14px 18px',
        boxShadow:     'var(--card-sh)',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        gap:           14,
        flexWrap:      'wrap',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="eyebrow" style={{ color: 'var(--text)', opacity: 0.7 }}>
          Working timer
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            className="mono"
            style={{
              fontSize:      28,
              fontWeight:    600,
              letterSpacing: '-0.02em',
              color:         isRunning ? 'var(--text)' : 'var(--sub)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight:    1.1,
            }}
          >
            {fmtClock(displayMs)}
          </span>
          <span
            aria-hidden
            style={{
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   isRunning ? 'var(--green)' : 'var(--text-faint)',
              animation:    isRunning ? 'tisBlink 1.6s ease-in-out infinite' : undefined,
            }}
            title={isRunning ? 'Running' : 'Paused'}
          />
          <span style={{ fontSize: 12, color: 'var(--sub)' }}>
            {isRunning ? 'Running' : 'Paused'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {isRunning ? (
          <button
            type="button"
            onClick={pause}
            className="btn btn-wn"
            title="Pause the visible timer (e.g. toilet break)"
          >
            <PauseIcon /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={resume}
            className="btn btn-ok"
            title="Resume the timer"
          >
            <PlayIcon /> Restart
          </button>
        )}
        <button
          type="button"
          onClick={reset}
          className="btn btn-gh"
          title="Reset the visible timer to 0:00:00"
        >
          <ResetIcon /> Reset
        </button>
      </div>
    </div>
  )
}

/* ─── Icons ──────────────────────────────────────────────────────────── */

function PauseIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6"  y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )
}
