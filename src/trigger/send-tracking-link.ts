/**
 * Trigger.dev task — `send-tracking-link`.
 *
 * Backs the CS-side "Send tracking link" button. Same fail-soft
 * behaviour as `notify-status-change` — wraps the existing
 * `sendManualTrackingLink()` so we don't fork the implementation.
 */

import { logger, task } from '@trigger.dev/sdk/v3'
import { sendManualTrackingLink } from '@/lib/notifications'

export const sendTrackingLinkTask = task({
  id:          'send-tracking-link',
  maxDuration: 60,
  run: async (payload: { caseId: string }) => {
    logger.info('send-tracking-link start', payload)
    const result = await sendManualTrackingLink({ caseId: payload.caseId })
    logger.info('send-tracking-link done', { ...payload, ...result })
    return result
  },
})
