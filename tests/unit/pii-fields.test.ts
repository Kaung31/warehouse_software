import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  PII_FIELDS,
  isPiiField,
  redactSnapshot,
  diffSnapshots,
  type RedactedPII,
} from '@/lib/pii-fields'

/* ─── PII inventory shape ─────────────────────────────────────────── */

describe('PII_FIELDS inventory', () => {
  it('covers Customer with the full approved set', () => {
    const c = PII_FIELDS.Customer
    expect(c.has('email')).toBe(true)
    expect(c.has('phone')).toBe(true)
    expect(c.has('addressLine1')).toBe(true)
    expect(c.has('addressLine2')).toBe(true)
    expect(c.has('postcode')).toBe(true)
    expect(c.has('name')).toBe(true)
    expect(c.has('city')).toBe(true)
    expect(c.has('notes')).toBe(true)
  })

  it('covers User including name (Pass 2 addition)', () => {
    expect(PII_FIELDS.User.has('email')).toBe(true)
    expect(PII_FIELDS.User.has('name')).toBe(true)
  })

  it('covers RepairOrder free-text fields', () => {
    const r = PII_FIELDS.RepairOrder
    for (const f of ['faultDescription','diagnosis','resolution','internalNotes','rechargeReason','csPaymentNote']) {
      expect(r.has(f)).toBe(true)
    }
  })

  it('covers CaseComment.content and Photo.caption (Pass 2 additions)', () => {
    expect(PII_FIELDS.CaseComment.has('content')).toBe(true)
    expect(PII_FIELDS.Photo.has('caption')).toBe(true)
  })

  it('does NOT include the deliberately-excluded operational identifiers', () => {
    // User.clerkId — opaque auth token, ops-readable
    expect(PII_FIELDS.User.has('clerkId')).toBe(false)
    // Scooter.serialNumber — device id, not personal data
    expect(PII_FIELDS.Scooter).toBeUndefined()
  })
})

/* ─── isPiiField ──────────────────────────────────────────────────── */

describe('isPiiField', () => {
  it('returns true for known PII fields on known models', () => {
    expect(isPiiField('Customer', 'email')).toBe(true)
    expect(isPiiField('User', 'email')).toBe(true)
    expect(isPiiField('RepairOrder', 'diagnosis')).toBe(true)
    expect(isPiiField('Photo', 'caption')).toBe(true)
  })

  it('returns false for non-PII fields on known models', () => {
    expect(isPiiField('Customer', 'createdAt')).toBe(false)
    expect(isPiiField('RepairOrder', 'status')).toBe(false)
    expect(isPiiField('User', 'role')).toBe(false)
  })

  it('returns false for unknown models (no inventory entry)', () => {
    expect(isPiiField('Scooter',          'serialNumber')).toBe(false)
    expect(isPiiField('NonexistentModel', 'whatever')).toBe(false)
  })
})

/* ─── redactSnapshot ──────────────────────────────────────────────── */

describe('redactSnapshot', () => {
  it('returns null for null/undefined snapshot', () => {
    expect(redactSnapshot('Customer', null)).toBeNull()
    expect(redactSnapshot('Customer', undefined)).toBeNull()
  })

  it('returns a shallow copy when the model has no PII config', () => {
    const snap   = { id: 'x', kind: 'A' }
    const result = redactSnapshot('UnknownModel', snap)
    expect(result).toEqual(snap)
    expect(result).not.toBe(snap)         // new object — caller can't mutate ours
  })

  it('replaces PII fields with the redacted shape and preserves the rest', () => {
    const snap = {
      id:           'cust-1',
      name:         'James Wilson',
      email:        'james@mail.com',
      phone:        '07700900001',
      city:         'London',
      postcode:     'SW1A 1AA',
      createdAt:    '2026-01-01T00:00:00Z',  // not PII
      isDeleted:    false,                   // not PII
    }
    const redacted = redactSnapshot('Customer', snap) as Record<string, unknown>

    // Non-PII fields untouched
    expect(redacted.id).toBe('cust-1')
    expect(redacted.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(redacted.isDeleted).toBe(false)

    // PII fields redacted to the canonical shape
    for (const key of ['name','email','phone','city','postcode']) {
      const v = redacted[key] as RedactedPII
      expect(v.__pii).toBe(true)
      expect(typeof v.hash).toBe('string')
      expect((v.hash as string).length).toBe(64) // sha256 hex
      expect(typeof v.len).toBe('number')
    }
  })

  it('hash is deterministic for the same input', () => {
    const a = redactSnapshot('Customer', { email: 'james@mail.com' }) as Record<string, RedactedPII>
    const b = redactSnapshot('Customer', { email: 'james@mail.com' }) as Record<string, RedactedPII>
    expect(a.email.hash).toBe(b.email.hash)
    // And matches an independent sha256 of the source.
    const expected = createHash('sha256').update('james@mail.com').digest('hex')
    expect(a.email.hash).toBe(expected)
  })

  it('hash differs for different inputs', () => {
    const a = redactSnapshot('Customer', { email: 'james@mail.com' }) as Record<string, RedactedPII>
    const b = redactSnapshot('Customer', { email: 'sarah@mail.com' }) as Record<string, RedactedPII>
    expect(a.email.hash).not.toBe(b.email.hash)
  })

  it('len reflects the source value’s string length', () => {
    const r = redactSnapshot('Customer', { email: 'james@mail.com' }) as Record<string, RedactedPII>
    expect(r.email.len).toBe('james@mail.com'.length)
  })

  it('handles null PII values without crashing — leaves them as null', () => {
    const r = redactSnapshot('Customer', { email: null, phone: undefined }) as Record<string, unknown>
    expect(r.email).toBeNull()
    expect(r.phone).toBeNull()
  })

  it('handles non-string PII values by JSON-stringifying first', () => {
    // Defensive — Prisma snapshots normally pass strings, but if a
    // future PII field is numeric we still want a stable hash.
    const r = redactSnapshot(
      'Customer',
      { email: { weird: 'shape' } as unknown as string },
    ) as Record<string, RedactedPII>
    expect(r.email.__pii).toBe(true)
    const expected = createHash('sha256').update(JSON.stringify({ weird: 'shape' })).digest('hex')
    expect(r.email.hash).toBe(expected)
  })
})

/* ─── diffSnapshots ───────────────────────────────────────────────── */

describe('diffSnapshots', () => {
  it('returns null when either side is null', () => {
    expect(diffSnapshots(null, { a: 1 })).toBeNull()
    expect(diffSnapshots({ a: 1 }, null)).toBeNull()
    expect(diffSnapshots(null, null)).toBeNull()
  })

  it('returns null when no fields differ', () => {
    expect(diffSnapshots({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeNull()
  })

  it('returns only the changed keys with both sides', () => {
    const d = diffSnapshots(
      { a: 1, b: 2, c: 'same' },
      { a: 1, b: 99, c: 'same' },
    )
    expect(d).toEqual({ b: { before: 2, after: 99 } })
  })

  it('handles fields present on one side only', () => {
    const d = diffSnapshots(
      { a: 1 },
      { a: 1, b: 2 },
    )
    expect(d).toEqual({ b: { before: undefined, after: 2 } })
  })

  it('preserves redacted shape on both sides', () => {
    // The audit helper redacts BEFORE diffing, so this reflects the
    // real call sequence.
    const before = redactSnapshot('Customer', { email: 'a@b' })
    const after  = redactSnapshot('Customer', { email: 'c@d' })
    const d      = diffSnapshots(before, after)
    expect(d).not.toBeNull()
    expect((d!.email.before as RedactedPII).__pii).toBe(true)
    expect((d!.email.after  as RedactedPII).__pii).toBe(true)
  })
})
