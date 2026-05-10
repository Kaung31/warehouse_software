/**
 * Integration test setup.
 *
 * Refuses to run unless DATABASE_URL is set, so a typo or missing env
 * doesn't accidentally run against a dev DB. The CI runner provides a
 * Neon CI branch URL via DATABASE_URL; locally, set TEST_DATABASE_URL
 * (we copy it into DATABASE_URL here) so the dev DB stays untouched.
 *
 * Per-suite cleanup (call from each test file's beforeEach):
 *   import { resetDb } from './setup'
 *   beforeEach(resetDb)
 *
 * Tables reset cover:
 *   audit_log, outbox_event   — what we're verifying
 *   case_status_history       — read-side projection touched by cs-update
 *   case_comment              — touched by cs-update
 *   invoice_reference         — touched by cs-update
 *   repair_order              — the business row
 *   scooter, customer, user, warehouse_location — fixtures
 */

import { afterAll } from 'vitest'

// Copy TEST_DATABASE_URL → DATABASE_URL if the former is set. Lets devs
// keep their day-to-day .env DATABASE_URL pointed at the dev DB while
// CI runs against a dedicated branch.
if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL?.includes('test')) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'Integration tests require DATABASE_URL (or TEST_DATABASE_URL). ' +
    'Set it to a Neon CI branch URL or a disposable local Postgres.',
  )
}

// Belt-and-braces: refuse to run if DATABASE_URL looks like prod. The
// safety net is "name your CI branch with `test` or `ci` in it".
const url = process.env.DATABASE_URL
if (/prod|main\.|production/.test(url) && !/test|ci/.test(url)) {
  throw new Error(`Refusing to run integration tests against URL that looks like prod: ${url.slice(0, 40)}…`)
}

// Stub external services for the WHOLE suite. The tests assert against
// the captured calls, so no test should re-mock these.
import { vi } from 'vitest'

// Pusher — capture broadcastCaseUpdate calls.
export const pusherCaptured: Array<Record<string, unknown>> = []
vi.mock('@/lib/pusher', () => ({
  broadcastCaseUpdate: vi.fn(async (args: Record<string, unknown>) => {
    pusherCaptured.push(args)
  }),
  broadcastUserNotification: vi.fn(async () => {}),
  authorizeChannel:           vi.fn(),
  channels:                   { case: (id: string) => `private-case-${id}` },
}))

// Trigger.dev — capture tasks.trigger calls (and the idempotencyKey).
export const triggerCaptured: Array<{ taskId: string; payload: unknown; opts?: { idempotencyKey?: string } }> = []
vi.mock('@trigger.dev/sdk/v3', async () => {
  // Pull in the real module first so our partial mock keeps everything
  // we don't override (schedules.task, task, logger, etc.) intact.
  const actual = await vi.importActual<typeof import('@trigger.dev/sdk/v3')>('@trigger.dev/sdk/v3')
  return {
    ...actual,
    tasks: {
      trigger: vi.fn(async (taskId: string, payload: unknown, opts?: { idempotencyKey?: string }) => {
        triggerCaptured.push({ taskId, payload, opts })
        return { id: `run_${triggerCaptured.length}` }
      }),
    },
  }
})

// Cache — count invalidate calls per case id.
export const cacheCaptured: { invalidatedCaseIds: string[] } = { invalidatedCaseIds: [] }
vi.mock('@/lib/cache', () => ({
  invalidateCaseCache: vi.fn(async (caseId?: string) => {
    cacheCaptured.invalidatedCaseIds.push(caseId ?? '')
  }),
  invalidate:          vi.fn(async () => {}),
  cached:              vi.fn(async <T,>(_k: string, factory: () => Promise<T>) => factory()),
  dashboardKey:        vi.fn(),
}))

// Clerk — pretend a user is signed in. Each test seeds a User with
// the matching clerkId via fixtures.
export const FAKE_CLERK_ID = 'clerk_test_user_csupdate'
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: FAKE_CLERK_ID })),
}))

/* ─── Cleanup helpers ─────────────────────────────────────────────── */

import { prisma } from '@/lib/prisma'

/**
 * Truncate every table touched by the integration suite, then reset the
 * mock capture arrays. Cascades into dependent rows (audit_log etc).
 */
export async function resetDb(): Promise<void> {
  // CASCADE handles foreign-key children (case_status_history, etc).
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "outbox_event",
      "audit_log",
      "CustomerNotification",
      "CaseStatusHistory",
      "CaseComment",
      "InvoiceReference",
      "RepairOrder",
      "Scooter",
      "Customer",
      "WarehouseLocation",
      "User"
    RESTART IDENTITY CASCADE
  `)

  pusherCaptured.length              = 0
  triggerCaptured.length             = 0
  cacheCaptured.invalidatedCaseIds.length = 0
}

afterAll(async () => {
  await prisma.$disconnect()
})
