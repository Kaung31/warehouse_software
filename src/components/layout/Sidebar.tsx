'use client'

import { Fragment, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayout } from './LayoutClient'

/**
 * Sidebar — left navigation rail.
 *
 * v2 changes (April 2026):
 *   • Replaced ALL emoji/Unicode-geometric icons with consistent inline
 *     SVG icons (Lucide style, 18 px, 1.6 px stroke, currentColor).
 *     Custom scooter icon is the brand-defining mark — no other admin
 *     template has it.
 *   • Role-aware filtering: each NAV item can declare which roles see it.
 *     ADMIN/MANAGER always see everything. /users is admin-only.
 *   • Optional `counts` prop: parent passes a Record keyed by href, badges
 *     render automatically. No more hardcoded `badge: 0`.
 *   • Section breaks now survive role filtering — every item declares its
 *     section, header renders when section changes, not on first item only.
 *   • Role dot colours moved from hex to CSS variables (theme-adaptive).
 *
 * Component is a server-prop boundary: parent (LayoutClient) fetches
 * counts and passes them down. Sidebar itself does no data fetching.
 */

/* ─── Icon set (inline SVG) ────────────────────────────────────────── */

type IconName =
  | 'dashboard'
  | 'cases'
  | 'bgrade'
  | 'scan'
  | 'map'
  | 'pallet'
  | 'wrench'
  | 'scooter'
  | 'user'
  | 'users'
  | 'chart'
  | 'workshop'
  | 'book'

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
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
    case 'dashboard':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
      )
    case 'cases':
      return (
        <svg {...p}>
          <path d="M9 3h6a1 1 0 0 1 1 1v1H8V4a1 1 0 0 1 1-1z" />
          <path d="M16 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <path d="M9 12h6M9 16h6" />
        </svg>
      )
    case 'bgrade':
      return (
        <svg {...p}>
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L3 13V3h10l7.59 7.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
        </svg>
      )
    case 'scan':
      return (
        <svg {...p}>
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M7 8v8M11 8v8M15 8v8M17 8v8" />
        </svg>
      )
    case 'map':
      return (
        <svg {...p}>
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
          <line x1="9" y1="3" x2="9" y2="18" />
          <line x1="15" y1="6" x2="15" y2="21" />
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
    case 'wrench':
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    case 'scooter':
      // Custom kick-scooter icon — the brand mark.
      // Two wheels, deck, slanted stem, T-bar handlebar.
      return (
        <svg {...p}>
          <circle cx="5" cy="18" r="2.5" />
          <circle cx="17" cy="18" r="2.5" />
          <path d="M7.5 18H14.5" />
          <path d="M15 18 L18 5" />
          <path d="M14 5 H22" />
        </svg>
      )
    case 'user':
      return (
        <svg {...p}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )
    case 'users':
      return (
        <svg {...p}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...p}>
          <line x1="3" y1="20" x2="21" y2="20" />
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="12" y1="20" x2="12" y2="10" />
          <line x1="18" y1="20" x2="18" y2="6" />
        </svg>
      )
    case 'workshop':
      // Toolbox — distinct from the single 'wrench' icon used for
      // Parts & Stock. Lid + body shape reads well at 18 px.
      return (
        <svg {...p}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          <line x1="2" y1="13" x2="22" y2="13" />
        </svg>
      )
    case 'book':
      // Open book — used for the Repair guides nav entry.
      return (
        <svg {...p}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      )
    default:
      return null
  }
}


/* ─── Nav definition ───────────────────────────────────────────────── */

type NavItem = {
  section: string
  href: string
  label: string
  icon: IconName
  /** Roles allowed to see this item. Undefined = all roles. ADMIN/MANAGER always see all. */
  roles?: string[]
  /** Tone of the badge (default red). */
  badgeTone?: 'red' | 'blue' | 'amber'
}

const NAV: NavItem[] = [
  { section: 'Operations', href: '/dashboard', label: 'Dashboard',     icon: 'dashboard' },
  { section: 'Operations', href: '/cases',     label: 'Cases',         icon: 'cases',    badgeTone: 'blue' },
  { section: 'Operations', href: '/b-grade',   label: 'B-Grade',       icon: 'bgrade',   badgeTone: 'amber' },
  { section: 'Operations', href: '/scan',      label: 'Quick Scan',    icon: 'scan' },

  { section: 'Warehouse',  href: '/locations', label: 'Warehouse Map', icon: 'map' },
  { section: 'Warehouse',  href: '/pallets',   label: 'Pallets',       icon: 'pallet' },

  { section: 'Inventory',  href: '/parts',     label: 'Parts & Stock', icon: 'wrench' },
  { section: 'Inventory',  href: '/scooters',  label: 'Scooters',      icon: 'scooter' },
  { section: 'Inventory',  href: '/customers', label: 'Customers',     icon: 'user',
    roles: ['ADMIN', 'MANAGER', 'CS'] },

  { section: 'Admin',      href: '/users',     label: 'Users',         icon: 'users',
    roles: ['ADMIN', 'MANAGER'] },
  { section: 'Admin',      href: '/reports',   label: 'Reports',       icon: 'chart' },
]

/**
 * MECHANIC nav — Phase A focused workspace.
 *
 * Mechanics see only the three things they need: their workshop, the
 * repair-guide library (so they can browse without an active case),
 * and the parts catalogue.
 *
 * Quick Scan was dropped — the workshop's parts picker scans barcodes
 * inline, so a top-level scan tab duplicates that.
 *
 * Admins and managers continue to see the full NAV above.
 */
const MECHANIC_NAV: NavItem[] = [
  { section: 'Workshop',  href: '/workshop',       label: 'Workshop',        icon: 'workshop' },
  { section: 'Workshop',  href: '/repair-guides',  label: 'Repair guides',   icon: 'book' },
  { section: 'Workshop',  href: '/parts',          label: 'Parts catalogue', icon: 'wrench' },
]

/** Tone class suffix for the .nb-badge element (matches globals.css). */
const TONE_CLASS: Record<NonNullable<NavItem['badgeTone']>, string> = {
  red:   '',
  blue:  'bl',
  amber: 'am',
}


/* ─── Role accent colours (theme-adaptive via CSS vars) ──────────── */

const ROLE_COLORS: Record<string, string> = {
  ADMIN:     'var(--purple)',
  MANAGER:   'var(--blue)',
  CS:        'var(--amber)',
  WAREHOUSE: 'var(--green)',
  MECHANIC:  'var(--orange)',
}


/* ─── Helpers ──────────────────────────────────────────────────────── */

function canSee(item: NavItem, role: string): boolean {
  if (role === 'ADMIN' || role === 'MANAGER') return true
  if (!item.roles) return true
  return item.roles.includes(role)
}


/* ─── Component ────────────────────────────────────────────────────── */

type Props = {
  role: string
  name: string
  /** Live counts keyed by href (e.g. counts['/cases'] = 7). Optional. */
  counts?: Record<string, number>
}

export default function Sidebar({ role, name, counts }: Props) {
  const pathname = usePathname()
  const { collapsed } = useLayout()
  const roleColor = ROLE_COLORS[role] ?? 'var(--slate)'
  const initials = (name || role || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    if (href === '/workshop') {
      // Highlight Workshop on /workshop and /workshop/job/[id].
      return pathname === '/workshop' || pathname.startsWith('/workshop/')
    }
    if (href === '/cases') {
      return (
        pathname === '/cases' ||
        (pathname.startsWith('/cases/') && !pathname.startsWith('/cases/new'))
      )
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  // Mechanics get a focused 3-item nav. Everyone else gets the standard
  // NAV (with the existing role gates inside `canSee`).
  const visibleNav =
    role === 'MECHANIC'
      ? MECHANIC_NAV
      : NAV.filter(item => canSee(item, role))

  // Precompute "is this the first item in its section?" via an index
  // lookup so the render body doesn't need a `let lastSection` mutated
  // across iterations (which trips `react-hooks/immutability`).
  const navWithSectionFlags = useMemo(
    () =>
      visibleNav.map((item, i) => ({
        item,
        showSection: i === 0 || visibleNav[i - 1].section !== item.section,
      })),
    [visibleNav],
  )

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* Logo */}
      <div className="sb-top">
        <div className="sb-logo-mark">SH</div>
        {!collapsed && (
          <div className="sb-logo-text">
            <div className="sb-name">ScooterHub</div>
            <div className="sb-sub">Command Center</div>
          </div>
        )}
      </div>

      {/* Role chip */}
      {!collapsed && role && (
        <div className="sb-role">
          <span className="rdot" style={{ background: roleColor }} />
          <div>
            <div className="rname">{role}</div>
            <div className="rsub">Active</div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {navWithSectionFlags.map(({ item, showSection: showSec }) => {
          const active = isActive(item.href)

          const badgeCount = counts?.[item.href] ?? 0
          const showBadge = badgeCount > 0
          const toneClass = TONE_CLASS[item.badgeTone ?? 'red']

          return (
            <Fragment key={item.href}>
              {showSec && !collapsed && (
                <div className="sb-sec">{item.section}</div>
              )}
              {showSec && collapsed && <div className="sb-divider" />}

              <Link
                href={item.href}
                className={`nb${active ? ' active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="nb-icon">
                  <Icon name={item.icon} />
                </span>

                {!collapsed && <span className="nb-label">{item.label}</span>}

                {!collapsed && showBadge && (
                  <span className={`nb-badge ${toneClass}`}>{badgeCount}</span>
                )}
                {collapsed && showBadge && (
                  <span
                    className={`nb-badge ${toneClass}`}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      padding: '1px 4px',
                      minWidth: 'auto',
                      fontSize: 9,
                    }}
                  >
                    {badgeCount}
                  </span>
                )}
              </Link>
            </Fragment>
          )
        })}
      </div>

      {/* User footer */}
      <div className="sb-foot">
        <div className="urow">
          <div className="uav">{initials}</div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name || 'User'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--sub)' }}>{role}</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}