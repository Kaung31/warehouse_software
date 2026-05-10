import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * dispatch-outbox unit tests.
 *
 * Strategy
 *   - We test the per-row decision tree (`processRow`) and the
 *     backoff helpers (`_internal.computeBackoffMs`, `_internal.shouldGiveUp`)
 *     in isolation. A real Postgres + Trigger.dev runtime is the job
 *     of Phase 4 integration tests against the Neon CI branch.
 *   - Prisma, Sentry, the Upstash lock, and the pino logger are all
 *     mocked. The dispatch table is the real singleton, mutated in
 *     each test so we can register fake handlers per-case.
 *   - Capture object lives in `vi.hoisted(...)` so the mock factories
 *     can reach it after Vitest module-graph hoisting.
 *
 * What we do NOT test here
 *   - The polling SELECT (raw SQL + FOR UPDATE SKIP LOCKED) — needs
 *     real Postgres.
 *   - The cross-instance lock (`withLock`) — Phase 2 already covered
 *     it.
 *   - The cron schedule wiring — Trigger.dev's responsibility.
 */

/* ─── Mock setup (must precede the SUT import) ───────────────────── */

const captured = vi.hoisted(() => ({
  /** Every `tx.$executeRaw\`…\`` invocation. The dispatcher writes its
   *  own outbox_event UPDATEs via raw SQL — see the "Audit-write
   *  guard" block in src/trigger/dispatch-outbox.ts for why. */
  rawSql:            [] as Array<{ sql: string, values: unknown[] }>,
  /** Sentry calls so we can assert per-row alerts fire. */
  sentryMessages:    [] as Array<{ message: string, opts: Record<string, unknown> }>,
  sentryExceptions:  [] as Array<{ err: unknown, opts: Record<string, unknown> }>,
  sentryBreadcrumbs: [] as Array<Record<string, unknown>>,
  /** Pino-level logs so we can assert per-row trace lines fire with eventId. */
  appLogs:           [] as Array<{ level: 'debug' | 'warn' | 'error', obj: Record<string, unknown>, msg: string }>,
}))

vi.mock('@/lib/prisma', () => {
  // The real prisma module also exports _withAuditWriteAllowed; we
  // expose a passthrough so `dispatchOneBatch` (not under test here)
  // would still work if a future test pulls it in.
  return {
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
    },
    _withAuditWriteAllowed: vi.fn(async (fn: () => unknown) => fn()),
  }
})

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn((message: string, opts: Record<string, unknown>) => {
    captured.sentryMessages.push({ message, opts })
  }),
  captureException: vi.fn((err: unknown, opts: Record<string, unknown>) => {
    captured.sentryExceptions.push({ err, opts })
  }),
  addBreadcrumb: vi.fn((bc: Record<string, unknown>) => {
    captured.sentryBreadcrumbs.push(bc)
  }),
}))

vi.mock('@/lib/logger', () => {
  const logger = {
    debug: vi.fn((obj: Record<string, unknown>, msg: string) => {
      captured.appLogs.push({ level: 'debug', obj, msg })
    }),
    warn: vi.fn((obj: Record<string, unknown>, msg: string) => {
      captured.appLogs.push({ level: 'warn', obj, msg })
    }),
    error: vi.fn((obj: Record<string, unknown>, msg: string) => {
      captured.appLogs.push({ level: 'error', obj, msg })
    }),
    info:  vi.fn(),
    child: vi.fn(() => logger),
  }
  return { logger, withCorrelation: () => logger }
})

vi.mock('@/lib/locks', () => ({
  withLock: vi.fn(async (_key: string, fn: () => unknown) => fn()),
}))

// Import AFTER the mocks register.
import { _internal } from '@/trigger/dispatch-outbox'
import {
  dispatchTable,
  NO_HANDLER_MARKER,
  type OutboxEventInput,
} from '@/trigger/outbox-dispatch-table'

/* ─── Helpers ─────────────────────────────────────────────────────── */

/**
 * Build a minimal raw-SQL row matching the dispatcher's `OutboxRow`
 * type. Snake_case to match the postgres column names.
 */
function makeRow(overrides: Partial<{
  id:            string
  aggregateType: string
  aggregateId:   string
  eventType:     string
  payload:       Record<string, unknown>
  attempts:      number
  maxAttempts:   number
}> = {}) {
  return {
    id:             overrides.id            ?? 'evt-1',
    aggregate_type: overrides.aggregateType ?? 'case',
    aggregate_id:   overrides.aggregateId   ?? 'ro-1',
    event_type:     overrides.eventType     ?? 'case.status_changed',
    payload:        overrides.payload       ?? { fromStatus: 'A', toStatus: 'B' },
    attempts:       overrides.attempts      ?? 0,
    max_attempts:   overrides.maxAttempts   ?? 10,
  }
}

/**
 * Build a fake transaction object whose `$executeRaw` records the
 * called SQL fragment + bound values into `captured.rawSql`.
 *
 * `tx.$executeRaw` is a tagged template literal; Prisma desugars
 * `tx.$executeRaw\`UPDATE … ${id}\`` to `$executeRaw(strings, ...values)`
 * where `strings` is the TemplateStringsArray and `values` is the
 * bound interpolations. We render the SQL with `?` placeholders so
 * the test can pattern-match on column names + keywords without
 * dealing with array indices.
 */
function makeTx() {
  return {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      captured.rawSql.push({
        sql:    strings.join('?'),
        values,
      })
      // $executeRaw resolves to a number (rows affected). Returning a
      // resolved Promise keeps `await tx.$executeRaw\`…\`` happy.
      return Promise.resolve(1)
    }),
  }
}

/**
 * Convenience: parse a captured raw-SQL UPDATE call and tell the test
 * which columns the update SETs and which value the WHERE clause
 * binds. Lets assertions stay readable.
 */
function decodeUpdate(call: { sql: string, values: unknown[] }) {
  const sql = call.sql.toLowerCase()
  return {
    sql,
    values:           call.values,
    setsProcessedAt:  /set[\s\S]*processed_at/.test(sql),
    setsLastError:    /set[\s\S]*last_error/.test(sql),
    setsAttempts:     /set[\s\S]*attempts/.test(sql),
    setsAvailableAt:  /set[\s\S]*available_at/.test(sql),
    isUpdate:         sql.trim().startsWith('') && sql.includes('update outbox_event'),
  }
}

function reset() {
  captured.rawSql            = []
  captured.sentryMessages    = []
  captured.sentryExceptions  = []
  captured.sentryBreadcrumbs = []
  captured.appLogs           = []
  // Wipe the dispatch table singleton between tests so a registration
  // in one test can't bleed into another.
  for (const key of Object.keys(dispatchTable)) {
    delete dispatchTable[key]
  }
}

beforeEach(reset)

/* ─── Pure helpers ────────────────────────────────────────────────── */

describe('_internal.computeBackoffMs', () => {
  it('returns 2^attempts seconds in ms for small attempt counts', () => {
    expect(_internal.computeBackoffMs(1)).toBe(2_000)
    expect(_internal.computeBackoffMs(2)).toBe(4_000)
    expect(_internal.computeBackoffMs(3)).toBe(8_000)
    expect(_internal.computeBackoffMs(4)).toBe(16_000)
  })

  it('still under cap at attempts=9 (512 s)', () => {
    expect(_internal.computeBackoffMs(9)).toBe(512_000)
    expect(_internal.computeBackoffMs(9)).toBeLessThan(_internal.MAX_BACKOFF_MS)
  })

  it('caps at MAX_BACKOFF_MS (10 minutes) when 2^attempts exceeds it', () => {
    expect(_internal.computeBackoffMs(10)).toBe(_internal.MAX_BACKOFF_MS)
    expect(_internal.computeBackoffMs(15)).toBe(_internal.MAX_BACKOFF_MS)
    expect(_internal.computeBackoffMs(100)).toBe(_internal.MAX_BACKOFF_MS)
  })

  it('MAX_BACKOFF_MS is exactly 10 minutes', () => {
    expect(_internal.MAX_BACKOFF_MS).toBe(10 * 60 * 1000)
  })
})

describe('_internal.shouldGiveUp', () => {
  it('false when attempts < max', () => {
    expect(_internal.shouldGiveUp(1, 10)).toBe(false)
    expect(_internal.shouldGiveUp(9, 10)).toBe(false)
  })

  it('true when attempts == max (this attempt was the last)', () => {
    expect(_internal.shouldGiveUp(10, 10)).toBe(true)
  })

  it('true when attempts > max (defensive — shouldnt happen, still dead)', () => {
    expect(_internal.shouldGiveUp(11, 10)).toBe(true)
  })
})

/* ─── processRow: no handler registered ──────────────────────────── */

describe('processRow — no handler', () => {
  it('marks the row processed with last_error = NO_HANDLER_MARKER and returns "noHandler"', async () => {
    const tx  = makeTx()
    const row = makeRow({ eventType: 'case.unknown_event' })
    const outcome = await _internal.processRow(tx as never, row as never)

    expect(outcome).toBe('noHandler')
    expect(captured.rawSql).toHaveLength(1)
    const u = decodeUpdate(captured.rawSql[0])
    expect(u.setsProcessedAt).toBe(true)
    expect(u.setsLastError).toBe(true)
    // SQL bound values: [NO_HANDLER_MARKER, row.id]
    expect(u.values).toContain(NO_HANDLER_MARKER)
    expect(u.values).toContain('evt-1')
  })

  it('emits a Sentry warning tagged with the unknown event_type', async () => {
    const tx  = makeTx()
    const row = makeRow({ eventType: 'case.unknown_event' })
    await _internal.processRow(tx as never, row as never)

    expect(captured.sentryMessages).toHaveLength(1)
    const m = captured.sentryMessages[0]
    expect(m.message).toContain('case.unknown_event')
    expect(m.opts.level).toBe('warning')
    expect((m.opts.tags as Record<string, string>).event_type).toBe('case.unknown_event')
  })

  it('logs a warn line with the eventId so it can be grepped end-to-end', async () => {
    const tx  = makeTx()
    const row = makeRow({ id: 'evt-no-handler', eventType: 'case.unknown_event' })
    await _internal.processRow(tx as never, row as never)

    const warns = captured.appLogs.filter(l => l.level === 'warn')
    expect(warns).toHaveLength(1)
    expect(warns[0].msg).toBe('outbox: no handler registered')
    expect(warns[0].obj.eventId).toBe('evt-no-handler')
    expect(warns[0].obj.eventType).toBe('case.unknown_event')
    expect(warns[0].obj.aggregateType).toBe('case')
    expect(warns[0].obj.aggregateId).toBe('ro-1')
  })
})

/* ─── processRow: success ────────────────────────────────────────── */

describe('processRow — handler success', () => {
  it('invokes the handler with the event input shape from the brief', async () => {
    const handler = vi.fn(async (input: OutboxEventInput) => { void input })
    dispatchTable['case.status_changed'] = handler

    const tx  = makeTx()
    const row = makeRow()
    const outcome = await _internal.processRow(tx as never, row as never)

    expect(outcome).toBe('processed')
    expect(handler).toHaveBeenCalledTimes(1)
    const arg = handler.mock.calls[0][0]
    expect(arg.eventId).toBe('evt-1')
    expect(arg.aggregateType).toBe('case')
    expect(arg.aggregateId).toBe('ro-1')
    expect(arg.eventType).toBe('case.status_changed')
    expect(arg.payload).toEqual({ fromStatus: 'A', toStatus: 'B' })
  })

  it('marks the row processed with last_error cleared', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => {})
    const tx = makeTx()
    await _internal.processRow(tx as never, makeRow() as never)

    expect(captured.rawSql).toHaveLength(1)
    const u = decodeUpdate(captured.rawSql[0])
    expect(u.setsProcessedAt).toBe(true)
    // last_error is set to literal NULL in the SQL, not a bound value.
    expect(u.sql).toMatch(/last_error\s*=\s*null/)
    // Only bound value is the row id (in WHERE).
    expect(u.values).toEqual(['evt-1'])
  })

  it('logs a debug line + adds a Sentry breadcrumb with eventId and durationMs', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => {})
    const tx = makeTx()
    await _internal.processRow(tx as never, makeRow({ id: 'evt-success' }) as never)

    const debugs = captured.appLogs.filter(l => l.level === 'debug')
    expect(debugs).toHaveLength(1)
    expect(debugs[0].msg).toBe('outbox: row processed')
    expect(debugs[0].obj.eventId).toBe('evt-success')
    expect(debugs[0].obj.eventType).toBe('case.status_changed')
    expect(typeof debugs[0].obj.durationMs).toBe('number')
    expect(debugs[0].obj.durationMs).toBeGreaterThanOrEqual(0)

    expect(captured.sentryBreadcrumbs).toHaveLength(1)
    const bc = captured.sentryBreadcrumbs[0]
    expect(bc.category).toBe('outbox')
    expect((bc.data as Record<string, unknown>).eventId).toBe('evt-success')
  })

  it('does NOT raise a Sentry exception on success', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => {})
    const tx = makeTx()
    await _internal.processRow(tx as never, makeRow() as never)

    expect(captured.sentryExceptions).toHaveLength(0)
    expect(captured.sentryMessages).toHaveLength(0)
  })
})

/* ─── processRow: handler throws (still has retries) ─────────────── */

describe('processRow — handler failure with retries left', () => {
  it('returns "failed", bumps attempts, sets last_error, advances available_at by backoff', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw new Error('downstream timeout') })
    const tx  = makeTx()
    const row = makeRow({ attempts: 0, maxAttempts: 10 })
    const before = Date.now()
    const outcome = await _internal.processRow(tx as never, row as never)
    const after = Date.now()

    expect(outcome).toBe('failed')
    expect(captured.rawSql).toHaveLength(1)
    const u = decodeUpdate(captured.rawSql[0])
    expect(u.setsAttempts).toBe(true)
    expect(u.setsLastError).toBe(true)
    expect(u.setsAvailableAt).toBe(true)
    expect(u.setsProcessedAt).toBe(false)         // NOT marking processed
    // Bound values, in template order: [attempts, errorMessage, availableAt, id]
    expect(u.values[0]).toBe(1)                   // post-increment
    expect(u.values[1]).toBe('downstream timeout')
    const av = u.values[2] as Date
    expect(av).toBeInstanceOf(Date)
    // Backoff for attempts=1 is 2 s; allow ±a few ms for clock drift.
    expect(av.getTime()).toBeGreaterThanOrEqual(before + 2_000 - 5)
    expect(av.getTime()).toBeLessThanOrEqual(after + 2_000 + 5)
    expect(u.values[3]).toBe('evt-1')
  })

  it('logs a warn line including backoffMs and the truncated error', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw new Error('boom') })
    const tx = makeTx()
    await _internal.processRow(tx as never, makeRow({ id: 'evt-retry', attempts: 2 }) as never)

    const warns = captured.appLogs.filter(l => l.level === 'warn')
    expect(warns).toHaveLength(1)
    expect(warns[0].msg).toBe('outbox: handler failed — retry scheduled')
    expect(warns[0].obj.eventId).toBe('evt-retry')
    expect(warns[0].obj.attempts).toBe(3)
    // attempts=3 → 8 s backoff
    expect(warns[0].obj.backoffMs).toBe(8_000)
    expect(warns[0].obj.errorMessage).toBe('boom')
  })

  it('truncates very long error messages to 1024 chars', async () => {
    const long = 'x'.repeat(5_000)
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw new Error(long) })
    const tx = makeTx()
    await _internal.processRow(tx as never, makeRow() as never)

    const u = decodeUpdate(captured.rawSql[0])
    // values: [attempts, errorMessage, availableAt, id] — errorMessage is index 1.
    expect((u.values[1] as string).length).toBe(1024)
  })

  it('handles non-Error throws (string, object) by stringifying', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw 'not an error instance' })
    const tx = makeTx()
    const outcome = await _internal.processRow(tx as never, makeRow() as never)

    expect(outcome).toBe('failed')
    const u = decodeUpdate(captured.rawSql[0])
    expect(u.values[1]).toBe('not an error instance')
  })
})

/* ─── processRow: handler throws and we're out of attempts ───────── */

describe('processRow — handler failure, dead letter', () => {
  it('returns "dead" when post-increment attempts >= max_attempts', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw new Error('fatal') })
    const tx  = makeTx()
    // attempts=9, this fail bumps to 10 == max → dead
    const row = makeRow({ attempts: 9, maxAttempts: 10 })
    const outcome = await _internal.processRow(tx as never, row as never)
    expect(outcome).toBe('dead')
  })

  it('does NOT set processed_at on dead (row stays visible to ops queries)', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw new Error('fatal') })
    const tx  = makeTx()
    const row = makeRow({ attempts: 9, maxAttempts: 10 })
    await _internal.processRow(tx as never, row as never)

    const u = decodeUpdate(captured.rawSql[0])
    expect(u.setsProcessedAt).toBe(false)         // stays visible to ops
    expect(u.setsAvailableAt).toBe(false)         // we do NOT advance — pointless
    expect(u.setsAttempts).toBe(true)
    expect(u.setsLastError).toBe(true)
    // values for dead branch: [attempts, errorMessage, id]
    expect(u.values[0]).toBe(10)
    expect(u.values[1]).toBe('fatal')
    expect(u.values[2]).toBe('evt-1')
  })

  it('Sentry-captures the original Error instance with the dead-letter tag set', async () => {
    const err = new Error('fatal')
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw err })
    const tx = makeTx()
    await _internal.processRow(
      tx as never,
      makeRow({ id: 'evt-dead', attempts: 9, maxAttempts: 10 }) as never,
    )

    expect(captured.sentryExceptions).toHaveLength(1)
    const sx = captured.sentryExceptions[0]
    expect(sx.err).toBe(err)
    expect((sx.opts.tags as Record<string, string>).outbox_state).toBe('dead')
    expect((sx.opts.extra as Record<string, unknown>).eventId).toBe('evt-dead')
  })

  it('logs an error line with attempts/maxAttempts/errorMessage', async () => {
    dispatchTable['case.status_changed'] = vi.fn(async () => { throw new Error('fatal') })
    const tx = makeTx()
    await _internal.processRow(
      tx as never,
      makeRow({ id: 'evt-dead-log', attempts: 9, maxAttempts: 10 }) as never,
    )

    const errs = captured.appLogs.filter(l => l.level === 'error')
    expect(errs).toHaveLength(1)
    expect(errs[0].msg).toBe('outbox: dead letter')
    expect(errs[0].obj.eventId).toBe('evt-dead-log')
    expect(errs[0].obj.attempts).toBe(10)
    expect(errs[0].obj.maxAttempts).toBe(10)
    expect(errs[0].obj.errorMessage).toBe('fatal')
  })
})

/* ─── handleFailure: direct invocation ────────────────────────────── */

describe('handleFailure — direct', () => {
  it('uses post-increment attempts (row.attempts + 1)', async () => {
    const tx = makeTx()
    await _internal.handleFailure(tx as never, makeRow({ attempts: 5 }) as never, new Error('oops'))
    // retry-branch values: [attempts, errorMessage, availableAt, id]
    expect(captured.rawSql[0].values[0]).toBe(6)
  })

  it('produces backoff matching computeBackoffMs(post-increment attempts)', async () => {
    const tx = makeTx()
    const before = Date.now()
    await _internal.handleFailure(tx as never, makeRow({ attempts: 4 }) as never, new Error('e'))
    // retry-branch values: [attempts, errorMessage, availableAt, id]
    const av = captured.rawSql[0].values[2] as Date
    // attempts=5 → 32 s backoff
    expect(av.getTime() - before).toBeGreaterThanOrEqual(32_000 - 50)
    expect(av.getTime() - before).toBeLessThanOrEqual(32_000 + 50)
  })

  it('respects per-row max_attempts override (3 instead of 10)', async () => {
    const tx = makeTx()
    // attempts=2 with max_attempts=3 → post-increment 3 → dead
    const outcome = await _internal.handleFailure(
      tx as never,
      makeRow({ attempts: 2, maxAttempts: 3 }) as never,
      new Error('e'),
    )
    expect(outcome).toBe('dead')
  })
})
