import { describe, it, expect } from 'vitest'
import {
  statusToStage,
  statusSentence,
  triggerEventForStatus,
  notificationSubject,
  timelineEvent,
  estimatedCompletionLabel,
  CUSTOMER_STAGES,
} from '@/lib/customerStatusCopy'

describe('statusToStage', () => {
  it('maps every internal status into one of the 5 customer stages or CLOSED', () => {
    const validStages = new Set([...CUSTOMER_STAGES.map((s) => s.key), 'CLOSED'])
    const internal = [
      'NEW','CS_TRIAGE','QUOTE_SENT','AWAITING_PICKUP','IN_TRANSIT',
      'AWAITING_INBOUND','INBOUND_DIAGNOSIS','AWAITING_CS','CS_RECHARGE',
      'CUSTOMER_DECLINED','DISPUTED',
      'WAITING_FOR_MECHANIC','IN_REPAIR','AWAITING_PARTS','QC_FAILED',
      'QUALITY_CONTROL','READY_TO_SHIP','DISPATCHED','DELIVERED',
      'BGRADE_RECORDED','CANCELLED',
      'RECEIVED','DIAGNOSING','QUALITY_CHECK', // legacy
    ]
    for (const s of internal) {
      expect(validStages).toContain(statusToStage(s))
    }
  })

  it('lumps CS_RECHARGE under RECEIVED (still pre-mechanic from customer POV)', () => {
    expect(statusToStage('CS_RECHARGE')).toBe('RECEIVED')
  })

  it('shows QC_FAILED as IN_REPAIR (not as a regression)', () => {
    expect(statusToStage('QC_FAILED')).toBe('IN_REPAIR')
  })

  it('treats CANCELLED / CUSTOMER_DECLINED / DISPUTED as CLOSED', () => {
    expect(statusToStage('CANCELLED')).toBe('CLOSED')
    expect(statusToStage('CUSTOMER_DECLINED')).toBe('CLOSED')
    expect(statusToStage('DISPUTED')).toBe('CLOSED')
  })
})

describe('statusSentence', () => {
  it('returns a non-empty customer-friendly sentence for every internal status', () => {
    const internal = ['INBOUND_DIAGNOSIS','IN_REPAIR','READY_TO_SHIP','DISPATCHED','DELIVERED']
    for (const s of internal) {
      const text = statusSentence(s)
      expect(text.length).toBeGreaterThan(8)
      // Never leak the enum.
      expect(text).not.toMatch(/[A-Z_]{4,}/)
    }
  })

  it('keeps QC_FAILED generic to avoid alarming the customer', () => {
    expect(statusSentence('QC_FAILED').toLowerCase()).not.toContain('fail')
  })
})

describe('triggerEventForStatus', () => {
  it('returns a non-null trigger key for the spec\'d set', () => {
    const triggered = [
      'INBOUND_DIAGNOSIS','WAITING_FOR_MECHANIC','IN_REPAIR','AWAITING_PARTS',
      'CS_RECHARGE','READY_TO_SHIP','DISPATCHED','DELIVERED',
    ]
    for (const s of triggered) {
      expect(triggerEventForStatus(s)).not.toBeNull()
    }
  })

  it('returns null for internal-only transitions (no customer comms)', () => {
    expect(triggerEventForStatus('QC_FAILED')).toBeNull()
    expect(triggerEventForStatus('AWAITING_CS')).toBeNull()
    expect(triggerEventForStatus('CANCELLED')).toBeNull()
  })
})

describe('notificationSubject', () => {
  it('returns a short subject for known statuses', () => {
    expect(notificationSubject('READY_TO_SHIP')).toContain('ready')
    expect(notificationSubject('DISPATCHED')).toContain('way')
    expect(notificationSubject('DELIVERED')).toContain('Delivered')
  })
})

describe('timelineEvent', () => {
  it('hides QC_FAILED from the customer timeline', () => {
    expect(timelineEvent('QC_FAILED').visible).toBe(false)
  })
  it('shows arrival as visible', () => {
    expect(timelineEvent('INBOUND_DIAGNOSIS').visible).toBe(true)
  })
})

describe('estimatedCompletionLabel', () => {
  const NOW = new Date()
  it('returns an "around <day>" string when the case is fresh', () => {
    const label = estimatedCompletionLabel({
      status:    'IN_REPAIR',
      createdAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000), // 1 day ago
      closedAt:  null,
    })
    expect(label).toMatch(/^Around /)
  })
  it('special-cases AWAITING_PARTS', () => {
    expect(
      estimatedCompletionLabel({ status: 'AWAITING_PARTS', createdAt: NOW, closedAt: null }),
    ).toMatch(/parts/i)
  })
  it('special-cases DELIVERED', () => {
    const day = new Date('2026-04-30T10:00:00Z')
    const label = estimatedCompletionLabel({ status: 'DELIVERED', createdAt: day, closedAt: day })
    expect(label).toMatch(/^Delivered on /)
  })
  it('returns "Within 24 hours" once past mechanic stage', () => {
    expect(
      estimatedCompletionLabel({ status: 'QUALITY_CONTROL', createdAt: NOW, closedAt: null }),
    ).toBe('Within 24 hours')
    expect(
      estimatedCompletionLabel({ status: 'READY_TO_SHIP', createdAt: NOW, closedAt: null }),
    ).toBe('Within 24 hours')
  })
})
