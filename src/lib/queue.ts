/**
 * Phase 3 — generic task queueing helper.
 *
 * Wraps `tasks.trigger()` from `@trigger.dev/sdk/v3` so callers don't
 * need to know whether the runtime has Trigger.dev configured. If
 * `TRIGGER_SECRET_KEY` is missing (local dev without the worker), we
 * fall back to running the task body inline by importing the named
 * task and invoking its `run()` method. That lets devs work without
 * standing up the Trigger.dev local runner.
 *
 * Real production behaviour: returns the queued run id and the API
 * route returns immediately. The Resend / Twilio sends happen on the
 * worker process within ~1 second.
 */

import { tasks } from '@trigger.dev/sdk/v3'
import { logger } from './logger'

const HAS_TRIGGER = !!process.env.TRIGGER_SECRET_KEY

/** Trigger a Trigger.dev task by id. Returns the run id for tracing. */
export async function enqueue<T extends Record<string, unknown>>(
  taskId:  string,
  payload: T,
): Promise<{ runId: string | null; mode: 'queued' | 'inline' | 'dropped' }> {
  if (HAS_TRIGGER) {
    try {
      const handle = await tasks.trigger(taskId, payload)
      return { runId: handle.id, mode: 'queued' }
    } catch (err) {
      logger.warn({ err, taskId }, 'enqueue: tasks.trigger failed — falling back to inline')
      // fall through to inline
    }
  }

  // Inline fallback — useful for local dev. Imports the task lazily
  // so we don't pull every task module just to enqueue one.
  try {
    const inline = await runInline(taskId, payload)
    return { runId: null, mode: inline ? 'inline' : 'dropped' }
  } catch (err) {
    logger.error({ err, taskId, payload }, 'enqueue: inline fallback failed')
    return { runId: null, mode: 'dropped' }
  }
}

async function runInline(taskId: string, payload: Record<string, unknown>): Promise<boolean> {
  switch (taskId) {
    case 'notify-status-change': {
      const { notifyStatusChange } = await import('./notifications')
      await notifyStatusChange({
        caseId:   String(payload.caseId),
        toStatus: String(payload.toStatus),
      })
      return true
    }
    case 'send-tracking-link': {
      const { sendManualTrackingLink } = await import('./notifications')
      await sendManualTrackingLink({ caseId: String(payload.caseId) })
      return true
    }
    case 'process-case-photo': {
      // No inline equivalent yet — Cloudflare warm is a best-effort
      // background optimisation; skip in dev.
      return false
    }
    default:
      logger.warn({ taskId }, 'enqueue: no inline fallback for taskId')
      return false
  }
}
