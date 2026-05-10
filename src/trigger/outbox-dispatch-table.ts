/**
 * Outbox dispatch table — the canonical mapping from `event_type` to
 * the side-effect handler that fires when the dispatcher drains the
 * `outbox_event` table.
 *
 * Phase 4 populates the first two entries, both emitted by the
 * `cs-update` handler: `case.status_changed` and
 * `case.payment_state_changed`. Future migrations append to this table
 * without changing the dispatcher.
 *
 * Idempotency rule (hard, from the project brief):
 *   Each handler receives `eventId` (== outbox_event.id, a UUID).
 *   The handler MUST pass that id verbatim as the idempotency key
 *   for any downstream side-effect that supports one:
 *
 *     - tasks.trigger():       pass `{ idempotencyKey: eventId }`. The
 *                              Trigger.dev SDK dedupes server-side so a
 *                              re-drained event doesn't queue the same
 *                              run twice.
 *     - Pusher broadcast:      include `eventId` in the message body so
 *                              clients can dedupe by it. Pusher itself
 *                              has no server-side idempotency primitive.
 *     - Cache invalidation:    DEL is idempotent by nature; eventId is
 *                              still useful for log correlation.
 *     - autoSetLocation:       sets the row to a function of toStatus,
 *                              so re-running is a no-op.
 *
 *   Why this matters: the dispatcher is at-least-once. A row may be
 *   processed twice if the worker crashes between handler success and
 *   the final UPDATE. Without idempotency, the customer gets two
 *   "your scooter has arrived" emails.
 *
 * Adding a handler:
 *   1. Add the entry to `dispatchTable` below, keyed by exact
 *      event_type string ("case.status_changed" etc.).
 *   2. Implement the handler as `(event) => Promise<void>`.
 *   3. Validate `event.payload` with Zod at the top of the handler so
 *      a producer-side schema drift surfaces as a typed error in
 *      Sentry rather than a silent miss.
 *   4. Pass `event.eventId` to every downstream side-effect that
 *      accepts an idempotency key.
 *   5. Keep handlers thin — wrap downstream calls, don't put business
 *      logic here. The business logic already ran inside the
 *      originating `withAuditedTransaction`; this code just fans out
 *      to the world.
 */

import { z } from 'zod'
import { tasks } from '@trigger.dev/sdk/v3'
import { broadcastCaseUpdate } from '@/lib/pusher'
import { invalidateCaseCache } from '@/lib/cache'
import { autoSetLocation }     from '@/lib/autoLocation'

/**
 * The shape the dispatcher hands to a handler. All fields come
 * straight from the `outbox_event` row that prompted the dispatch.
 *
 * `payload` is whatever the producer wrote — handler is responsible
 * for narrowing the type via Zod or a discriminated union if it
 * cares about specific fields. The dispatcher doesn't validate.
 */
export type OutboxEventInput = {
  /** outbox_event.id (UUID). MUST be passed as idempotency key
   *  to every downstream side-effect that supports one. */
  eventId:       string
  aggregateType: string
  aggregateId:   string
  eventType:     string
  payload:       Record<string, unknown>
}

/**
 * Side-effect handler. Throw to signal failure — the dispatcher
 * will catch, log, increment `attempts`, schedule the next retry
 * with exponential backoff, and (on max_attempts) Sentry-alert.
 *
 * Resolve to signal success — the dispatcher marks `processed_at`.
 *
 * Hard rule: idempotent. Re-running the same event id must produce
 * the same outcome (or be a no-op).
 */
export type OutboxEventHandler = (event: OutboxEventInput) => Promise<void>

/* ─── Payload schemas ─────────────────────────────────────────────────
 *
 * Each handler validates with a tight Zod schema before doing anything.
 * This means a producer-side breaking change shows up as a Zod error
 * (clear, in Sentry, with the offending field) rather than a silent
 * downstream regression.
 */

const caseStatusChangedPayload = z.object({
  caseId:         z.string().min(1),
  fromStatus:     z.string().min(1),
  toStatus:       z.string().min(1),
  changedById:    z.string().min(1),
  reason:         z.string().optional(),
  broadcastRole:  z.enum(['MECHANIC', 'CS', 'WAREHOUSE', 'INBOUND', 'MANAGER']),
  notifyCustomer: z.boolean(),
})

const casePaymentStateChangedPayload = z.object({
  caseId:        z.string().min(1),
  changedFields: z.object({
    csPaymentNote:     z.string().optional(),
    customerPrepaid:   z.boolean().optional(),
    warrantyConfirmed: z.boolean().optional(),
    paymentStatus:     z.string().optional(),
  }),
})

/* ─── The registry ────────────────────────────────────────────────── */

export const dispatchTable: Record<string, OutboxEventHandler> = {
  /**
   * Fan-out for a real status transition. Side effects, in dispatch
   * order:
   *   1. autoSetLocation       — move the scooter row to the warehouse
   *                              zone implied by the new status.
   *                              Idempotent (function of toStatus).
   *                              Done first so dashboards that read
   *                              location see the new value before the
   *                              realtime push hits them.
   *   2. invalidateCaseCache   — wipe dashboard + case-detail cache so
   *                              the next read picks up the new status.
   *                              DEL is naturally idempotent.
   *   3. broadcastCaseUpdate   — Pusher to private-case-<id> + the
   *                              role's presence dashboard. eventId
   *                              ships in the payload so subscribers
   *                              can dedupe.
   *   4. notify-status-change  — Trigger.dev task that sends Resend
   *                              email + Twilio SMS to the customer.
   *                              Skipped on disputes (internal).
   *                              eventId is the idempotencyKey so a
   *                              second drain doesn't double-send.
   */
  'case.status_changed': async (event) => {
    const p = caseStatusChangedPayload.parse(event.payload)

    await autoSetLocation(p.caseId, p.toStatus)
    await invalidateCaseCache(p.caseId)
    await broadcastCaseUpdate({
      caseId:   p.caseId,
      toStatus: p.toStatus,
      role:     p.broadcastRole,
      type:     'status_change',
      // Subscribers can dedupe on this if they want — Pusher itself
      // has no server-side idempotency primitive.
      payload:  { eventId: event.eventId },
    })

    if (p.notifyCustomer) {
      await tasks.trigger(
        'notify-status-change',
        { caseId: p.caseId, toStatus: p.toStatus },
        // SDK-level dedupe — re-draining this event is a no-op at the
        // Trigger.dev API.
        { idempotencyKey: event.eventId },
      )
    }
  },

  /**
   * Internal-only event for payment field edits that don't change the
   * case status. Cache-bust so the CS dashboard picks up the new
   * payment state — no Pusher broadcast (no UI listens), no customer
   * notification (internal accounting change).
   */
  'case.payment_state_changed': async (event) => {
    const p = casePaymentStateChangedPayload.parse(event.payload)
    await invalidateCaseCache(p.caseId)
  },
}

/**
 * Sentinel used by the dispatcher when marking a no-handler event as
 * processed. Centralised so log/alert filters can match on it.
 */
export const NO_HANDLER_MARKER = 'no_handler'
