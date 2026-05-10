/**
 * Trigger.dev task — `notify-status-change`.
 *
 * Replaces the inline `notifyStatusChange()` call from Phase B. The
 * API endpoint that used to send the notification synchronously now
 * just queues this task and returns immediately. The Trigger.dev
 * worker handles the Resend / Twilio sends, including retries on
 * transient provider failures.
 *
 * Inputs:
 *   - caseId        the RepairOrder this notification is about
 *   - toStatus      the customer-facing trigger key (e.g. 'IN_REPAIR',
 *                   'CS_RECHARGE'). The dispatcher resolves the
 *                   subject + body from `customerStatusCopy.ts`.
 *   - triggerEvent  optional override (the dispatcher derives one
 *                   from `toStatus` by default)
 *
 * Side effects:
 *   - Inserts the CustomerNotification audit row with status=QUEUED.
 *   - Sends the email and/or SMS (depending on customer preference).
 *   - Updates the row to SENT or FAILED.
 *
 * Behaviour matches `lib/notifications.ts:notifyStatusChange()`
 * exactly — we re-use that function inside the task body so there's
 * one canonical implementation. The "background" part is just where
 * the call lives, not what the call does.
 */

import { logger, task } from '@trigger.dev/sdk/v3'
import { notifyStatusChange } from '@/lib/notifications'

export const notifyStatusChangeTask = task({
  id:          'notify-status-change',
  // Notifications can wait — we're not blocking a user request.
  maxDuration: 60,
  run: async (payload: { caseId: string; toStatus: string }) => {
    logger.info('notify-status-change start', payload)
    await notifyStatusChange({ caseId: payload.caseId, toStatus: payload.toStatus })
    logger.info('notify-status-change done', payload)
  },
})
