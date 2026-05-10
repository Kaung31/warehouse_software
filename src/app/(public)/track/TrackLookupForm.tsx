'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'

/**
 * TrackLookupForm — client island for /track.
 *
 * Submits to POST /api/track/lookup. On success the API returns
 * { orderNumber, token } and we navigate to /track/[orderNumber]?token=…
 * via router.push so the URL has a copyable shape (and a bookmark in the
 * customer's browser would still expire after an hour).
 *
 * Errors are kept generic on purpose — the API also uses the same
 * generic copy. The customer never learns whether the order number
 * exists or which field was wrong.
 */
export default function TrackLookupForm() {
  const router = useRouter()
  const [orderNumber,  setOrderNumber]  = useState('')
  const [verification, setVerification] = useState('')
  const [busy,         setBusy]         = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!orderNumber.trim() || !verification.trim()) {
      setError('Please fill in both fields.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/track/lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          orderNumber:  orderNumber.trim(),
          verification: verification.trim(),
        }),
      })
      if (res.ok) {
        const body = await res.json()
        const ord  = body?.data?.orderNumber as string | undefined
        const tok  = body?.data?.token       as string | undefined
        if (ord && tok) {
          router.push(`/track/${encodeURIComponent(ord)}?token=${encodeURIComponent(tok)}`)
          return
        }
        setError("Couldn't process the response. Please try again.")
      } else {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <label
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span className="eyebrow" style={{ color: 'var(--sub)' }}>Order number</span>
        <input
          type="text"
          autoComplete="off"
          inputMode="text"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder="e.g. RO-000001"
          disabled={busy}
          required
          style={{ fontSize: 14 }}
        />
      </label>
      <label
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span className="eyebrow" style={{ color: 'var(--sub)' }}>
          Email or last 4 digits of phone
        </span>
        <input
          type="text"
          autoComplete="email"
          value={verification}
          onChange={(e) => setVerification(e.target.value)}
          placeholder="you@example.com   or   1234"
          disabled={busy}
          required
          style={{ fontSize: 14 }}
        />
      </label>
      {error && (
        <div className="al al-d" style={{ margin: 0 }}>
          {error}
        </div>
      )}
      <Btn variant="primary" loading={busy} type="submit" size="lg">
        Look up my repair
      </Btn>
    </form>
  )
}
