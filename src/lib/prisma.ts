import { PrismaClient, type Prisma } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Singleton Prisma client.
 *
 * Layered:
 *   1. `makeBaseClient()` — vanilla PrismaClient with the slow-query
 *      → Sentry listener (Phase 8 observability work).
 *   2. `$extends` query guard — blocks any direct write to
 *      `audit_log` / `outbox_event` from outside the audit-outbox
 *      helper. The guard reads an AsyncLocalStorage flag set by
 *      `withAuditWriteAllowed()` below, which `withAuditedTransaction`
 *      and the outbox dispatcher use to mark sanctioned access.
 *
 * Hard rule (project brief):
 *   "audit_log and outbox_event are append-only. processed_at is the
 *   single exception, set only by the dispatcher."
 *
 * The runtime guard is a defence-in-depth layer on top of the
 * code-review rule. If a future contributor accidentally reaches
 * for `prisma.auditEntry.create(...)` outside the helper, they get a
 * loud runtime error rather than a silently corrupt audit trail.
 */

const SLOW_QUERY_MS = 500

/* ─── Base client + slow-query telemetry ──────────────────────────── */

function makeBaseClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'error' },
          { emit: 'stdout', level: 'warn' },
        ]
      : [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'error' },
        ],
  })

  // Slow-query telemetry — fire to Sentry so we can spot regressions
  // in the dashboard rather than digging through logs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(client as any).$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration < SLOW_QUERY_MS) return
    Sentry.addBreadcrumb({
      category: 'prisma',
      message:  `slow query (${e.duration}ms)`,
      level:    'warning',
      data:     { query: e.query.slice(0, 1024), params: e.params, duration: e.duration },
    })
    Sentry.captureMessage(`Prisma slow query: ${e.duration}ms`, {
      level: 'warning',
      tags:  { component: 'prisma' },
      extra: { query: e.query.slice(0, 1024), params: e.params, duration: e.duration },
    })
  })

  return client
}

/* ─── Append-only guard for audit_log + outbox_event ──────────────── */

/**
 * Scope of this guard — important nuance:
 *
 *   The guard installs as a `$extends` query interceptor, so it sees
 *   typed-client writes only (`prisma.<model>.<op>` /
 *   `tx.<model>.<op>`). It is INVISIBLE to `$executeRaw` /
 *   `$queryRaw` — those bypass the typed surface and go straight to
 *   the engine.
 *
 *   That asymmetry is deliberate. The producer-side helper
 *   (`withAuditedTransaction` in `src/lib/audit-outbox.ts`) does
 *   inline back-to-back typed writes inside one tx callback, so the
 *   AsyncLocalStorage flag survives the chain and the guard does
 *   its job. The dispatcher, however, awaits arbitrary user-registered
 *   handler code BETWEEN its SELECT and per-row UPDATE — anything in
 *   that code path can disturb async_hooks state, leaving the flag
 *   unset and the typed-client UPDATE blocked. The dispatcher
 *   therefore does its own writes via `tx.$executeRaw` (see
 *   `src/trigger/dispatch-outbox.ts`), which the guard cannot see.
 *
 *   This is a sanctioned escape hatch for the dispatcher specifically.
 *   Any other code reaching for `$executeRaw` to write `audit_log` /
 *   `outbox_event` is a code-review red flag — it bypasses the very
 *   guarantee this guard exists to enforce. See ADR 0001 for the
 *   full rationale.
 */

/**
 * AsyncLocalStorage flag that flips to `true` for the duration of a
 * sanctioned write. Set ONLY by `withAuditWriteAllowed()`.
 *
 * AsyncLocalStorage propagates through async/await + Prisma
 * transactions for inline-write patterns, so the flag survives the
 * `prisma.$transaction(async (tx) => { tx.auditEntry.create(...) })`
 * boundary that the producer-side helper uses. It is NOT robust
 * across arbitrary user-supplied async work in the same call chain —
 * see the dispatcher note above for the case where this matters.
 */
const auditWriteAllowed = new AsyncLocalStorage<true>()

/**
 * Run `fn` with the audit-write flag enabled. Used by:
 *   - `withAuditedTransaction()` in src/lib/audit-outbox.ts
 *   - the outbox dispatcher in src/trigger/dispatch-outbox.ts
 *     (when toggling processed_at)
 *
 * Underscore-prefixed because it's a guarded primitive — the helpers
 * above are the public API. Direct callers are a code smell.
 */
export function _withAuditWriteAllowed<T>(fn: () => Promise<T>): Promise<T> {
  return auditWriteAllowed.run(true, fn)
}

const FORBIDDEN_DIRECT_WRITE =
  'Direct write to audit_log / outbox_event is forbidden. ' +
  'Use withAuditedTransaction() from src/lib/audit-outbox.ts.'

/** Centralised gate so the same error message is thrown everywhere. */
function assertAllowed(operation: string, model: 'audit_log' | 'outbox_event'): void {
  if (auditWriteAllowed.getStore()) return
  throw new Error(
    `${FORBIDDEN_DIRECT_WRITE} (blocked: ${model}.${operation})`,
  )
}

/* ─── Build the extended client ───────────────────────────────────── */

/**
 * Set of write operations that are allowed when the AsyncLocalStorage
 * flag is on. Reads (`findUnique`, `findMany`, `aggregate`, …) are
 * always permitted — anyone may inspect the audit trail.
 */
const SANCTIONED_WRITE_OPS = new Set<string>([
  'create', 'createMany',
  // outbox_event needs `update` for the dispatcher; audit_log doesn't,
  // and we additionally block update on AuditEntry below.
  'update', 'updateMany',
])

const ALWAYS_FORBIDDEN_OPS_AUDIT = new Set<string>([
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
])

const ALWAYS_FORBIDDEN_OPS_OUTBOX = new Set<string>([
  'upsert', 'delete', 'deleteMany',
])

function makeGuardedClient() {
  const base = makeBaseClient()

  // Use `$allModels.$allOperations` so the guard works regardless of
  // whether `prisma generate` has produced typed surface for
  // AuditEntry / OutboxEvent yet. We compare model names as strings.
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Cast through `string` so this still typechecks when the
          // local Prisma client hasn't been re-`generate`d yet after
          // schema additions (CI / fresh worktrees). The runtime
          // model name is always a string.
          const modelName = model as string
          const isAudit  = modelName === 'AuditEntry'
          const isOutbox = modelName === 'OutboxEvent'
          if (!isAudit && !isOutbox) return query(args)

          // Reads are always allowed.
          if (!SANCTIONED_WRITE_OPS.has(operation) &&
              !ALWAYS_FORBIDDEN_OPS_AUDIT.has(operation) &&
              !ALWAYS_FORBIDDEN_OPS_OUTBOX.has(operation)) {
            return query(args)
          }

          // Per-table absolute bans (no flag overrides these).
          if (isAudit  && ALWAYS_FORBIDDEN_OPS_AUDIT.has(operation)) {
            throw new Error(
              `${FORBIDDEN_DIRECT_WRITE} audit_log is append-only (blocked: AuditEntry.${operation}).`,
            )
          }
          if (isOutbox && ALWAYS_FORBIDDEN_OPS_OUTBOX.has(operation)) {
            throw new Error(
              `${FORBIDDEN_DIRECT_WRITE} outbox_event rows are evidence — never delete or upsert ` +
              `(blocked: OutboxEvent.${operation}).`,
            )
          }

          // Sanctioned writes (create/createMany on either table,
          // update/updateMany on outbox_event) require the ALS flag.
          assertAllowed(operation, isAudit ? 'audit_log' : 'outbox_event')
          return query(args)
        },
      },
    },
  })
}

/* ─── Singleton wiring ────────────────────────────────────────────── */

type GuardedPrisma = ReturnType<typeof makeGuardedClient>

const globalForPrisma = globalThis as unknown as {
  prisma: GuardedPrisma | undefined
}

export const prisma: GuardedPrisma = globalForPrisma.prisma ?? makeGuardedClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
