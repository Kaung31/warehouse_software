import { describe, it, expect } from 'vitest'
import { signTrackToken, verifyTrackToken } from '@/lib/track-token'

describe('signTrackToken / verifyTrackToken', () => {
  it('round-trips a payload', async () => {
    const orderId = 'cli_test_abc123'
    const token   = await signTrackToken(orderId)
    expect(token.split('.').length).toBe(3) // header.payload.signature

    const payload = await verifyTrackToken(token)
    expect(payload?.orderId).toBe(orderId)
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('returns null for tampered tokens', async () => {
    const token = await signTrackToken('cli_test')
    // Flip one byte in the signature
    const parts = token.split('.')
    parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a')
    const tampered = parts.join('.')

    expect(await verifyTrackToken(tampered)).toBeNull()
  })

  it('returns null for malformed tokens', async () => {
    expect(await verifyTrackToken('not.a.token')).toBeNull()
    expect(await verifyTrackToken('')).toBeNull()
  })
})
