'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Btn from '@/components/ui/Btn'
import { format } from 'date-fns'

/**
 * CommentsThread — conversation view on a case.
 *
 * v2 changes (April 2026):
 *   • Now posts to a dedicated /api/cases/[id]/comments endpoint instead
 *     of piggybacking on /api/cases/[id]/cs-update (which is the CS
 *     payment-update endpoint and shouldn't handle comments).
 *   • "Customer-facing" checkbox replaced with a tabbed toggle:
 *     "Reply to customer" / "Internal note" — Intercom / Front pattern.
 *     Active tab gets the accent fill, the other is muted.
 *   • Customer-facing replies render on a green-tinted background
 *     (so CS can scan the thread and see external comms quickly).
 *     Internal notes render on the default gray .cmt background.
 *   • System events (placeholder for now) — when we wire in
 *     CaseStatusHistory events into the thread later, they'll render
 *     as small inline rows with a dashed separator.
 *   • Avatars use 2-letter initials (matching Sidebar / KanbanBoard
 *     style), with deterministic role-based color.
 *   • Empty state uses the .empty-state classes — proper icon + message
 *     instead of bare gray text.
 *   • Textarea auto-grows (rows starts at 3, max 12) and supports
 *     Cmd+Enter to submit.
 *   • "customer-facing" badge uses .badge.badge-warranty class.
 *   • Loading state via Btn's loading prop instead of disabled+text swap.
 */

type Comment = {
  id: string
  content: string
  isCustomerFacing: boolean
  createdAt: string | Date
  author: { name: string; role: string }
}

type Props = {
  caseId: string
  comments: Comment[]
  userRole: string
  canComment: boolean
}

const ROLE_COLORS: Record<string, string> = {
  ADMIN:     'var(--purple)',
  MANAGER:   'var(--blue)',
  CS:        'var(--amber)',
  WAREHOUSE: 'var(--green)',
  MECHANIC:  'var(--orange)',
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

export default function CommentsThread({
  caseId,
  comments,
  canComment,
}: Props) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'internal' | 'customer'>('internal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cases/${caseId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text.trim(),
          isCustomerFacing: mode === 'customer',
        }),
      })
      if (res.ok) {
        setText('')
        router.refresh()
      } else {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Failed to post')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl + Enter submits
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Thread */}
      {comments.length === 0 ? (
        <div
          className="empty-state"
          style={{ padding: '24px 8px' }}
        >
          <div className="empty-state-icon">
            <CommentIcon />
          </div>
          <div className="empty-state-title">No comments yet</div>
          <div className="empty-state-msg">
            Add an internal note for the team or send a reply to the customer.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {comments.map(c => {
            const roleColor = ROLE_COLORS[c.author.role] ?? 'var(--slate)'
            const isCustomer = c.isCustomerFacing
            return (
              <div
                key={c.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius)',
                  background: isCustomer
                    ? 'var(--green-bg)'
                    : 'var(--s2)',
                  border: `1px solid ${
                    isCustomer ? 'var(--green-b)' : 'var(--border)'
                  }`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <div
                    className="av av-sm"
                    style={{ background: roleColor }}
                    title={`${c.author.name} (${c.author.role})`}
                  >
                    {initialsOf(c.author.name)}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
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
                      {c.author.name}
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          color: 'var(--text-faint)',
                          fontWeight: 400,
                          textTransform: 'uppercase',
                          letterSpacing: '.05em',
                        }}
                      >
                        {c.author.role}
                      </span>
                    </div>
                  </div>
                  {isCustomer && (
                    <span
                      className="badge badge-ready"
                      style={{ fontSize: 9, padding: '1px 7px' }}
                      title="Sent to customer"
                    >
                      <SendIcon />
                      To customer
                    </span>
                  )}
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-faint)',
                      fontFamily: 'var(--font-mono)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {format(new Date(c.createdAt), 'd MMM HH:mm')}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text)',
                    lineHeight: 1.55,
                    paddingLeft: 32,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {c.content}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Composer */}
      {canComment && (
        <div
          style={{
            marginTop: comments.length > 0 ? 14 : 0,
            paddingTop: comments.length > 0 ? 14 : 0,
            borderTop:
              comments.length > 0 ? '1px solid var(--border)' : 'none',
          }}
        >
          {/* Tab toggle */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              marginBottom: 8,
              padding: 3,
              background: 'var(--s2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              width: 'fit-content',
            }}
          >
            <button
              type="button"
              onClick={() => setMode('internal')}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 500,
                borderRadius: 'var(--radius-sm)',
                background:
                  mode === 'internal' ? 'var(--surface)' : 'transparent',
                color:
                  mode === 'internal' ? 'var(--text)' : 'var(--sub)',
                boxShadow:
                  mode === 'internal'
                    ? '0 1px 2px rgba(15, 23, 42, .05)'
                    : 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                transition: 'all .12s',
              }}
            >
              <LockIcon />
              Internal note
            </button>
            <button
              type="button"
              onClick={() => setMode('customer')}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 500,
                borderRadius: 'var(--radius-sm)',
                background:
                  mode === 'customer'
                    ? 'var(--green-bg)'
                    : 'transparent',
                color:
                  mode === 'customer'
                    ? 'var(--green-text)'
                    : 'var(--sub)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                transition: 'all .12s',
              }}
            >
              <SendIcon />
              Reply to customer
            </button>
          </div>

          <textarea
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'customer'
                ? 'Write a reply that will be visible to the customer…'
                : 'Internal note — visible only to your team…'
            }
            style={{
              resize: 'vertical',
              marginBottom: 8,
              minHeight: 70,
              maxHeight: 240,
              borderColor:
                mode === 'customer' ? 'var(--green-b)' : 'var(--border)',
            }}
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-faint)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ⌘+Enter to post
            </span>
            <Btn
              variant={mode === 'customer' ? 'success' : 'primary'}
              size="sm"
              loading={busy}
              disabled={!text.trim()}
              onClick={submit}
              iconLeft={mode === 'customer' ? <SendIcon /> : <LockIcon />}
            >
              {mode === 'customer' ? 'Send to customer' : 'Post note'}
            </Btn>
          </div>

          {error && (
            <div
              className="al al-d"
              style={{ marginTop: 8, marginBottom: 0 }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

function CommentIcon() {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}