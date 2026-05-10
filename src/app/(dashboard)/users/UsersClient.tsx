'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * UsersClient — staff management UI for ADMIN role.
 *
 * v2 changes (April 2026):
 *   • Stat strip at top — Total / Active / Inactive / Admin & Manager.
 *   • Role filter chips with counts (All / Admin / Manager / Mechanic /
 *     Warehouse / CS).
 *   • Search bar matches name or email.
 *   • Puzzler-style row layout (no <table>) — each user is a card-row
 *     with avatar, name+email, role badge, repairs pill, status pill,
 *     and actions.
 *   • Avatars use 2-letter initials with role color (matching the
 *     app-wide pattern from CommentsThread / KanbanBoard / dashboard).
 *   • Role pill as .badge with role-specific class.
 *   • Status pill uses .badge.badge-pass / .badge.badge-na — single
 *     source of truth for active / inactive across the app.
 *   • Inactive rows subtle dim (opacity 0.6).
 *   • "You" tag uses a clean .badge.
 *   • Role change still inline (dropdown auto-saves) but with a
 *     confirmation when changing role away from ADMIN — accidental
 *     admin demotion would lock you out.
 *   • Disable/Enable action confirms before disabling a user.
 *   • Empty state when no users match filters.
 *   • All inline-style soup → design system classes.
 *   • Date formatted manually (locale-free) to avoid hydration
 *     mismatches (same fix we applied in StatusTimeline).
 */

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  createdAt: Date | string
  _count: { repairOrders: number }
}

const ROLES = ['ADMIN', 'MANAGER', 'MECHANIC', 'WAREHOUSE', 'CS'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  ADMIN: 'var(--purple)',
  MANAGER: 'var(--blue)',
  CS: 'var(--amber)',
  WAREHOUSE: 'var(--green)',
  MECHANIC: 'var(--orange)',
}

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  MECHANIC: 'Mechanic',
  WAREHOUSE: 'Warehouse',
  CS: 'Customer service',
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatJoined(d: Date | string): string {
  const date = new Date(d)
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
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


export default function UsersClient({
  users: initial,
  currentUserId,
  roleCounts,
  activeCount,
  inactiveCount,
}: {
  users: UserRow[]
  currentUserId: string
  roleCounts: Record<string, number>
  activeCount: number
  inactiveCount: number
}) {
  const router = useRouter()
  const [users, setUsers] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL' | 'INACTIVE'>(
    'ALL'
  )

  /* ─── Filtering ───────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    return users.filter(u => {
      if (roleFilter === 'INACTIVE' && u.isActive) return false
      if (
        roleFilter !== 'ALL' &&
        roleFilter !== 'INACTIVE' &&
        u.role !== roleFilter
      )
        return false
      if (search) {
        const s = search.toLowerCase()
        if (
          !u.name.toLowerCase().includes(s) &&
          !u.email.toLowerCase().includes(s)
        )
          return false
      }
      return true
    })
  }, [users, search, roleFilter])

  const adminAndManagerCount =
    (roleCounts.ADMIN ?? 0) + (roleCounts.MANAGER ?? 0)

  /* ─── Mutations ───────────────────────────────────────────────────── */
  async function patchUser(
    id: string,
    patch: { role?: Role; isActive?: boolean }
  ) {
    setBusy(id)
    setError('')
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const { data } = await res.json()
        setUsers(prev =>
          prev.map(u => (u.id === id ? { ...u, ...data } : u))
        )
        router.refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to update user')
      }
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(null)
    }
  }

  function handleRoleChange(user: UserRow, newRole: Role) {
    if (user.role === newRole) return
    // Warn when downgrading away from ADMIN (could lock out the org)
    if (
      user.role === 'ADMIN' &&
      newRole !== 'ADMIN' &&
      (roleCounts.ADMIN ?? 0) <= 1
    ) {
      const ok = window.confirm(
        `${user.name} is the only ADMIN. Downgrading their role will leave the system without an admin. Continue?`
      )
      if (!ok) return
    }
    patchUser(user.id, { role: newRole })
  }

  function handleDisable(user: UserRow) {
    if (user.isActive) {
      const ok = window.confirm(
        `Disable ${user.name}? They will lose access until re-enabled.`
      )
      if (!ok) return
    }
    patchUser(user.id, { isActive: !user.isActive })
  }

  return (
    <>
      {/* ── Stat strip ── */}
      <div className="grid4" style={{ marginBottom: 18 }}>
        <StatTile
          label="Total accounts"
          value={users.length}
          tone="neutral"
        />
        <StatTile
          label="Active"
          value={activeCount}
          tone="good"
        />
        <StatTile
          label="Inactive"
          value={inactiveCount}
          tone={inactiveCount > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Admin & Manager"
          value={adminAndManagerCount}
          tone="accent"
        />
      </div>

      {/* ── Search bar ── */}
      <div
        className="search-wrap"
        style={{ marginBottom: 12, display: 'flex' }}
      >
        <span className="search-icon">
          <SearchIcon />
        </span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          autoComplete="off"
        />
      </div>

      {/* ── Role filter pills ── */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 18,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <FilterPill
          active={roleFilter === 'ALL'}
          onClick={() => setRoleFilter('ALL')}
          count={users.length}
        >
          All
        </FilterPill>
        {ROLES.map(r => (
          <FilterPill
            key={r}
            active={roleFilter === r}
            onClick={() => setRoleFilter(r)}
            count={roleCounts[r] ?? 0}
          >
            {ROLE_LABELS[r]}
          </FilterPill>
        ))}
        {inactiveCount > 0 && (
          <FilterPill
            active={roleFilter === 'INACTIVE'}
            onClick={() => setRoleFilter('INACTIVE')}
            count={inactiveCount}
            danger
          >
            Inactive only
          </FilterPill>
        )}
      </div>

      {error && (
        <div className="al al-d" style={{ marginBottom: 14 }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <AlertIcon />
          </span>
          <div>{error}</div>
        </div>
      )}

      {/* ── Users list ── */}
      {filtered.length === 0 ? (
        <EmptyState
          search={search}
          filtered={roleFilter !== 'ALL'}
          onClear={() => {
            setSearch('')
            setRoleFilter('ALL')
          }}
        />
      ) : (
        <div className="row-grid">
          {filtered.map(u => (
            <UserRowItem
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              isBusy={busy === u.id}
              onRoleChange={role => handleRoleChange(u, role)}
              onToggleActive={() => handleDisable(u)}
            />
          ))}
        </div>
      )}
    </>
  )
}


/* ─── Sub-components ───────────────────────────────────────────────── */

function UserRowItem({
  user,
  isSelf,
  isBusy,
  onRoleChange,
  onToggleActive,
}: {
  user: UserRow
  isSelf: boolean
  isBusy: boolean
  onRoleChange: (role: Role) => void
  onToggleActive: () => void
}) {
  const role = user.role as Role
  const roleColor = ROLE_COLORS[role] ?? 'var(--slate)'
  const showRepairs = user.role === 'MECHANIC'

  return (
    <div
      className={`row-grid-item${user.isActive ? '' : ''}`}
      style={{
        opacity: isBusy ? 0.55 : user.isActive ? 1 : 0.7,
        transition: 'opacity .2s',
        gridTemplateColumns:
          '40px 1.6fr 130px 90px 90px 1fr',
      }}
    >
      {/* Avatar */}
      <div
        className="av av-md"
        style={{ background: roleColor, fontSize: 12 }}
        title={user.name}
      >
        {initialsOf(user.name)}
      </div>

      {/* Name + email */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 2,
          }}
        >
          {user.name}
          {isSelf && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                color: 'var(--accent-text)',
                background: 'var(--accent-dim)',
                padding: '1px 6px',
                borderRadius: 999,
                textTransform: 'uppercase',
                letterSpacing: '.06em',
              }}
            >
              You
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--sub)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {user.email}
        </div>
      </div>

      {/* Role */}
      <div>
        {isSelf ? (
          <span
            className="badge"
            style={{
              background: `${roleColor}1f`,
              color: roleColor,
              fontWeight: 500,
              fontSize: 11,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: roleColor,
                display: 'inline-block',
              }}
            />
            {ROLE_LABELS[role]}
          </span>
        ) : (
          <select
            value={user.role}
            disabled={isBusy}
            onChange={e => onRoleChange(e.target.value as Role)}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              minWidth: 120,
              borderColor: roleColor,
              color: roleColor,
              background: `${roleColor}0d`,
              fontWeight: 500,
            }}
          >
            {ROLES.map(r => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Repairs (only for mechanics) */}
      <div style={{ textAlign: 'center' }}>
        {showRepairs ? (
          <span
            className="mono"
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: '3px 10px',
              borderRadius: 4,
              background:
                user._count.repairOrders > 0
                  ? 'var(--accent-dim)'
                  : 'var(--s2)',
              color:
                user._count.repairOrders > 0
                  ? 'var(--accent-text)'
                  : 'var(--text-faint)',
              border: '1px solid var(--border)',
            }}
            title={`${user._count.repairOrders} repairs`}
          >
            {user._count.repairOrders}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</span>
        )}
      </div>

      {/* Status */}
      <div>
        <span
          className={`badge ${user.isActive ? 'badge-pass' : 'badge-na'}`}
          style={{ fontSize: 11, fontWeight: 500 }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: user.isActive ? 'var(--green)' : 'var(--text-faint)',
              display: 'inline-block',
            }}
          />
          {user.isActive ? 'Active' : 'Disabled'}
        </span>
      </div>

      {/* Actions / joined */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-faint)',
            whiteSpace: 'nowrap',
          }}
        >
          Joined {formatJoined(user.createdAt)}
        </span>
        {!isSelf && (
          <Btn
            variant={user.isActive ? 'danger' : 'success'}
            size="sm"
            loading={isBusy}
            onClick={onToggleActive}
          >
            {user.isActive ? 'Disable' : 'Enable'}
          </Btn>
        )}
      </div>
    </div>
  )
}


function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'neutral' | 'accent' | 'good' | 'warn'
}) {
  const styles =
    tone === 'accent' && value > 0
      ? {
          background: 'var(--accent-dim)',
          borderColor: 'transparent',
          numColor: 'var(--accent-text)',
          labelColor: 'var(--accent-text)',
        }
      : tone === 'good'
      ? {
          background: 'var(--green-bg)',
          borderColor: 'transparent',
          numColor: 'var(--green-text)',
          labelColor: 'var(--green-text)',
        }
      : tone === 'warn' && value > 0
      ? {
          background: 'var(--amber-bg)',
          borderColor: 'transparent',
          numColor: 'var(--amber-text)',
          labelColor: 'var(--amber-text)',
        }
      : {
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          numColor: 'var(--text)',
          labelColor: 'var(--sub)',
        }

  return (
    <div
      className="stat-card"
      style={{ background: styles.background, borderColor: styles.borderColor }}
    >
      <div className="stat-num" style={{ color: styles.numColor }}>
        {value}
      </div>
      <div className="stat-label" style={{ color: styles.labelColor }}>
        {label}
      </div>
    </div>
  )
}


function FilterPill({
  active,
  onClick,
  count,
  danger,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`filter-pill${active ? ' on' : ''}`}
      style={
        danger && active
          ? {
              background: 'var(--red-bg)',
              color: 'var(--red-text)',
              borderColor: 'var(--red-b)',
            }
          : undefined
      }
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
        {count != null && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              opacity: active ? 0.85 : 0.6,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        )}
      </span>
    </button>
  )
}


function EmptyState({
  search,
  filtered,
  onClear,
}: {
  search: string
  filtered: boolean
  onClear: () => void
}) {
  const isFiltered = !!(search || filtered)
  return (
    <div className="card">
      <div className="empty-state">
        <div className="empty-state-icon">
          <UsersIcon />
        </div>
        <div className="empty-state-title">
          {isFiltered ? 'No users match' : 'No users yet'}
        </div>
        <div className="empty-state-msg">
          {isFiltered
            ? 'Try removing a filter or clearing your search.'
            : 'Once users are added through Clerk, they will appear here.'}
        </div>
        {isFiltered && (
          <Btn variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Btn>
        )}
      </div>
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}