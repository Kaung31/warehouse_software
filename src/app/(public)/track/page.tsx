import TrackLookupForm from './TrackLookupForm'

/**
 * /track — public lookup page.
 *
 * Server component shell. The form itself is a client component
 * (TrackLookupForm) because it submits via fetch and navigates the
 * router on success. The shell stays slim so the SEO copy is plain HTML.
 */

type SP = Promise<Record<string, string | string[] | undefined>>
export default async function TrackPage({
  searchParams,
}: { searchParams: SP }) {
  const sp = await searchParams
  // When a token expires we redirect back here with ?expired=1 so we
  // can show a friendly hint. No PII in the URL — just the flag.
  const expired = sp.expired === '1'

  return (
    <div
      style={{
        maxWidth:      460,
        margin:        '40px auto 0',
        padding:       '24px 24px 32px',
        background:    'var(--surface)',
        border:        '1px solid var(--border)',
        borderRadius:  'var(--radius-lg)',
        boxShadow:     'var(--card-sh)',
        display:       'flex',
        flexDirection: 'column',
        gap:           18,
      }}
    >
      <div>
        <div className="eyebrow" style={{ color: 'var(--sub)', marginBottom: 4 }}>
          Customer self-service
        </div>
        <h1 className="page-title" style={{ marginBottom: 6 }}>
          Track your repair
        </h1>
        <p
          style={{
            fontSize:   13,
            color:      'var(--sub)',
            lineHeight: 1.5,
            margin:     0,
          }}
        >
          Enter your order number and either the email address you booked
          with, or the last 4 digits of your phone number.
        </p>
      </div>

      {expired && (
        <div className="al al-w" style={{ margin: 0 }}>
          Your verification link expired. Please look up your order again.
        </div>
      )}

      <TrackLookupForm />

      <p
        style={{
          fontSize: 11,
          color:    'var(--text-faint)',
          margin:   0,
          lineHeight: 1.5,
        }}
      >
        For your privacy, we send you a private link valid for one hour.
        If you didn&apos;t receive a confirmation when you booked, contact
        our support team.
      </p>
    </div>
  )
}
