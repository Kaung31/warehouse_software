'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/dashboard',   label: 'Dashboard',    icon: '⊞' },
  { href: '/cases',       label: 'Cases',         icon: '⬡' },
  { href: '/scooters',    label: 'Scooters',      icon: '◎' },
  { href: '/customers',   label: 'Customers',     icon: '◈' },
  { href: '/parts',       label: 'Parts & Stock', icon: '◧' },
  { href: '/second-hand', label: 'Second Hand',   icon: '◑' },
  { href: '/reports',     label: 'Reports',       icon: '▦' },
  { href: '/users',       label: 'Users',         icon: '◉' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside style={{
      width:        224,
      background:   'var(--bg-surface)',
      borderRight:  '1px solid var(--border)',
      display:      'flex',
      flexDirection:'column',
      flexShrink:   0,
      position:     'sticky',
      top:          0,
      height:       '100vh',
    }}>
      {/* Logo */}
      <div style={{
        padding:      '18px 20px 16px',
        borderBottom: '1px solid var(--border)',
        display:      'flex',
        alignItems:   'center',
        gap:          10,
      }}>
        <div style={{
          width:        32,
          height:       32,
          background:   'var(--accent-dim)',
          borderRadius: 8,
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'center',
          fontSize:     16,
          flexShrink:   0,
        }}>
          ⚡
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            ScooterHub
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1 }}>
            Operations
          </div>
        </div>
      </div>

      {/* Section label */}
      <div style={{ padding: '16px 20px 6px' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Menu
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 10px', overflowY: 'auto' }}>
        {nav.map(({ href, label, icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link key={href} href={href} style={{ textDecoration: 'none' }}>
              <div style={{
                display:      'flex',
                alignItems:   'center',
                gap:          10,
                padding:      '8px 10px',
                marginBottom: 2,
                fontSize:     13,
                fontWeight:   active ? 500 : 400,
                color:        active ? 'var(--text)' : 'var(--text-muted)',
                background:   active ? 'var(--bg-hover)' : 'transparent',
                borderRadius: 'var(--radius)',
                borderLeft:   active ? '2px solid var(--accent)' : '2px solid transparent',
                transition:   'all 0.1s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-raised)' }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <span style={{ fontSize: 14, color: active ? 'var(--accent)' : 'var(--text-faint)', width: 18, textAlign: 'center' }}>
                  {icon}
                </span>
                {label}
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div style={{
        padding:    '12px 20px',
        borderTop:  '1px solid var(--border)',
        fontSize:   11,
        color:      'var(--text-faint)',
        fontFamily: 'var(--font-mono)',
      }}>
        v1.0.0 — MVP
      </div>
    </aside>
  )
}