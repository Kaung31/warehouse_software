'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { useLayout } from './LayoutClient'

/**
 * TopBarClient — sticky header with search, theme toggle, notifications.
 *
 * v2 changes (April 2026):
 *   • Replaced ALL emoji/Unicode icons with consistent inline SVG icons
 *     (16 px, 1.6 px stroke, currentColor) — matches Sidebar icon style.
 *   • Cmd+K / Ctrl+K shortcut, OS-aware: shows ⌘K on Mac, Ctrl K elsewhere.
 *     Old "/" hint kept as fallback shortcut (still focuses search).
 *   • Theme toggle uses real sun/moon SVGs, knob animation unchanged.
 *   • Notification panel: emojis replaced with semantic icon circles
 *     (red alert / amber pallet / amber warning / green check), making
 *     unread items easier to scan.
 *   • Role chip uses .rchip class from globals.css instead of inline
 *     styles — cleaner, theme-aware, hover-able.
 *   • Escape key closes notification panel.
 *   • TODO: search currently routes to /scan?q=… — Phase 5 swaps this
 *     for a proper Cmd+K command palette (cases, scooters, parts, customers).
 */

/* ─── Icon set ─────────────────────────────────────────────────────── */

type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'search'
  | 'sun'
  | 'moon'
  | 'bell'
  | 'alert'
  | 'pallet'
  | 'warn'
  | 'check'

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'chevron-left':
      return (
        <svg {...p}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg {...p}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <line x1="12" y1="2" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="22" />
          <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
          <line x1="2" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="22" y2="12" />
          <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
          <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...p}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )
    case 'bell':
      return (
        <svg {...p}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...p}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'pallet':
      return (
        <svg {...p}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22" x2="12" y2="12" />
        </svg>
      )
    case 'warn':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    default:
      return null
  }
}


/* ─── Notification icon circle ─────────────────────────────────────── */

type NotifTone = 'red' | 'amber' | 'green' | 'blue'

function NotifIcon({ icon, tone }: { icon: IconName; tone: NotifTone }) {
  const tones: Record<NotifTone, { bg: string; fg: string }> = {
    red:   { bg: 'var(--red-bg)',   fg: 'var(--red-text)' },
    amber: { bg: 'var(--amber-bg)', fg: 'var(--amber-text)' },
    green: { bg: 'var(--green-bg)', fg: 'var(--green-text)' },
    blue:  { bg: 'var(--blue-bg)',  fg: 'var(--blue-text)' },
  }
  const { bg, fg } = tones[tone]
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={14} />
    </span>
  )
}


/* ─── Mock notifications (Phase 6 will wire real data) ────────────── */

type Notif = {
  icon: IconName
  tone: NotifTone
  title: string
  sub: string
  unread: boolean
}

const NOTIFS: Notif[] = [
  { icon: 'alert',  tone: 'red',   title: 'Urgent case needs CS approval', sub: 'URGENT · check awaiting-CS queue',   unread: true  },
  { icon: 'pallet', tone: 'amber', title: 'Pallet nearly full',            sub: 'B-Grade pallet at 90% capacity',     unread: true  },
  { icon: 'warn',   tone: 'amber', title: 'Part low in stock',             sub: '36V Hub Motor — only 1 left',        unread: true  },
  { icon: 'check',  tone: 'green', title: 'QC passed',                     sub: 'Case ready to ship · 8m ago',        unread: false },
]


/* ─── Component ────────────────────────────────────────────────────── */

type Props = { role: string; name: string }

export default function TopBarClient({ role, name }: Props) {
  const router = useRouter()
  const { collapsed, setCollapsed, theme, setTheme } = useLayout()
  const [notifOpen, setNotifOpen] = useState(false)
  const [cmdVal, setCmdVal] = useState('')
  const [isMac, setIsMac] = useState(false)
  const cmdRef = useRef<HTMLInputElement>(null)

  // Detect platform (SSR-safe — only runs in browser)
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform))
  }, [])

  // Keyboard shortcuts: Cmd/Ctrl+K and "/" both focus search; Esc closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        cmdRef.current?.focus()
        cmdRef.current?.select()
        return
      }
      // "/" focuses search (when not already typing in an input)
      if (e.key === '/' && document.activeElement !== cmdRef.current) {
        const tag = (document.activeElement?.tagName ?? '').toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        e.preventDefault()
        cmdRef.current?.focus()
        return
      }
      // Escape closes notifications
      if (e.key === 'Escape' && notifOpen) {
        setNotifOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [notifOpen])

  function handleCmdEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !cmdVal.trim()) return
    const q = cmdVal.trim()
    setCmdVal('')
    // TODO (Phase 6): replace with Cmd+K palette routing across cases,
    //   scooters, parts, customers. For now, /scan handles the lookup.
    router.push(`/scan?q=${encodeURIComponent(q)}`)
  }

  const hasUnread = NOTIFS.some(n => n.unread)

  return (
    <header className="topbar">
      {/* Sidebar collapse */}
      <button
        type="button"
        className="tb-collapse"
        onClick={() => setCollapsed(!collapsed)}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
      </button>

      {/* Search */}
      <div className="cmd">
        <span className="cmd-icon">
          <Icon name="search" />
        </span>
        <input
          ref={cmdRef}
          value={cmdVal}
          onChange={e => setCmdVal(e.target.value)}
          onKeyDown={handleCmdEnter}
          placeholder="Scan or search — order #, serial, pallet, part…"
          aria-label="Search"
        />
        {!cmdVal && (
          <span className="cmd-k">{isMac ? '⌘K' : 'Ctrl K'}</span>
        )}
      </div>

      <div className="tb-right">
        {/* Role chip — uses .rchip class instead of inline styles */}
        {role && <span className="rchip">{role}</span>}

        <div className="divl" />

        {/* Theme toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>
            <Icon name="moon" size={13} />
          </span>
          <div
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            role="button"
            aria-label="Toggle theme"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setTheme(theme === 'dark' ? 'light' : 'dark')
              }
            }}
          >
            <div
              className={`theme-knob ${theme}`}
              style={{ color: theme === 'dark' ? 'var(--blue)' : 'var(--amber)' }}
            >
              <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={11} />
            </div>
          </div>
          <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>
            <Icon name="sun" size={13} />
          </span>
        </div>

        <div className="divl" />

        {/* Notifications */}
        <button
          type="button"
          className="icon-btn"
          onClick={() => setNotifOpen(o => !o)}
          title="Notifications"
          aria-label="Notifications"
          aria-expanded={notifOpen}
        >
          <Icon name="bell" />
          {hasUnread && <span className="notif-dot" />}
        </button>

        <UserButton />
      </div>

      {/* Notification panel */}
      {notifOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 699 }}
            onClick={() => setNotifOpen(false)}
          />
          <div className="notif-panel">
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                Notifications
              </span>
              <button
                type="button"
                style={{
                  fontSize: 11,
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 500,
                  background: 'none',
                  border: 'none',
                }}
                onClick={() => setNotifOpen(false)}
              >
                Mark all read
              </button>
            </div>
            {NOTIFS.map((n, i) => (
              <div key={i} className={`notif-item${n.unread ? ' unread' : ''}`}>
                <NotifIcon icon={n.icon} tone={n.tone} />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--text)',
                      lineHeight: 1.35,
                    }}
                  >
                    {n.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--sub)',
                      marginTop: 2,
                    }}
                  >
                    {n.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </header>
  )
}