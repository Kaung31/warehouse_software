'use client'
import { useState } from 'react'
import Link from 'next/link'

type Props = {
  caseId:        string
  orderNumber:   string
  customerEmail: string | null
  customerName:  string | null
}

export default function LabelActions({ caseId, orderNumber, customerEmail, customerName }: Props) {
  const [copied, setCopied] = useState<'link' | 'order' | null>(null)

  function copyText(text: string, type: 'link' | 'order') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  function openEmailDraft() {
    const subject = encodeURIComponent(`Your ScooterHub repair ticket — ${orderNumber}`)
    const body = encodeURIComponent(
      `Hi ${customerName ?? 'there'},\n\n` +
      `Your scooter has been registered for repair.\n\n` +
      `Your repair ticket number is: ${orderNumber}\n\n` +
      `Please keep this number handy — you can use it to check the status of your repair or contact us.\n\n` +
      `If you're sending the scooter to us, please print the attached label and secure it to the scooter or packaging before dispatch.\n\n` +
      `Thanks,\nThe ScooterHub Team`
    )
    const to = customerEmail ? encodeURIComponent(customerEmail) : ''
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank')
  }

  const labelUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/cases/${caseId}/label`
    : ''

  return (
    <div style={{
      display:      'flex',
      gap:          8,
      flexWrap:     'wrap',
      justifyContent: 'center',
      marginBottom: 4,
    }}>
      {/* Back */}
      <Link href={`/cases/${caseId}`}>
        <ActionBtn icon="←" label="Back to case" />
      </Link>

      {/* Print */}
      <ActionBtn
        icon="🖨"
        label="Print"
        onClick={() => window.print()}
      />

      {/* Copy order number */}
      <ActionBtn
        icon={copied === 'order' ? '✓' : '⎘'}
        label={copied === 'order' ? 'Copied!' : 'Copy order #'}
        onClick={() => copyText(orderNumber, 'order')}
        success={copied === 'order'}
      />

      {/* Copy label link */}
      <ActionBtn
        icon={copied === 'link' ? '✓' : '🔗'}
        label={copied === 'link' ? 'Link copied!' : 'Copy link'}
        onClick={() => copyText(labelUrl, 'link')}
        success={copied === 'link'}
      />

      {/* Email draft */}
      <ActionBtn
        icon="✉"
        label={customerEmail ? 'Email customer' : 'Draft email'}
        onClick={openEmailDraft}
      />
    </div>
  )
}

function ActionBtn({
  icon, label, onClick, success,
}: {
  icon: string; label: string; onClick?: () => void; success?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          6,
        padding:      '8px 14px',
        background:   success ? 'var(--green-bg)' : 'var(--bg-surface)',
        border:       `1px solid ${success ? 'var(--green)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        cursor:       onClick ? 'pointer' : 'default',
        fontSize:     13,
        fontWeight:   500,
        color:        success ? 'var(--green)' : 'var(--text)',
        transition:   'all 0.15s',
        textDecoration: 'none',
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
