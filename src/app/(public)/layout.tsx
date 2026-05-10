import Link from 'next/link'

/**
 * (public) route group — Phase B customer-facing pages.
 *
 * No Clerk gating (the matcher in src/proxy.ts whitelists /track and
 * /api/track), no internal sidebar/topbar, no zone bar. Just a clean
 * shell with the brand mark and a footer pointing back to support.
 *
 * Pages live in subdirectories (e.g. /track, /track/[orderNumber]).
 * The root layout already mounts <ClerkProvider> and the design-token
 * CSS, so we only need page chrome here.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display:        'flex',
        flexDirection:  'column',
        minHeight:      '100vh',
        background:     'var(--bg)',
        color:          'var(--text)',
      }}
    >
      <header
        style={{
          padding:    '18px 24px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          display:    'flex',
          alignItems: 'center',
          gap:        12,
        }}
      >
        <Link
          href="/"
          aria-label="ScooterHub home"
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            gap:            10,
            color:          'var(--text)',
            textDecoration: 'none',
          }}
        >
          <div
            className="sb-logo-mark"
            style={{ width: 32, height: 32, fontSize: 13 }}
          >
            SH
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>ScooterHub</span>
            <span style={{ fontSize: 11, color: 'var(--sub)' }}>Repair tracker</span>
          </div>
        </Link>
      </header>

      <main
        style={{
          flex:    1,
          padding: '32px 20px',
          width:   '100%',
        }}
      >
        {children}
      </main>

      <footer
        style={{
          padding:     '18px 24px',
          borderTop:   '1px solid var(--border)',
          background:  'var(--surface)',
          color:       'var(--sub)',
          fontSize:    12,
          display:     'flex',
          flexWrap:    'wrap',
          gap:         12,
          justifyContent: 'space-between',
        }}
      >
        <span>© ScooterHub Repair Centre</span>
        <span>
          Need help? <a
            href="mailto:support@scooterhub.example"
            style={{ color: 'var(--accent-text)' }}
          >
            support@scooterhub.example
          </a>
        </span>
      </footer>
    </div>
  )
}
