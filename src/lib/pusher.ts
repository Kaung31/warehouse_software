/**
 * Phase 7 — Pusher Channels (server side).
 *
 * Channel naming convention:
 *   - `private-case-<caseId>`               every case-detail subscriber
 *   - `presence-dashboard-<role>`            kanban + dashboards
 *                                            (presence channel = shows
 *                                            who else is viewing)
 *   - `private-user-<userId>`                personal notifications
 *
 * Auth: Pusher requires server-signed authentication for private and
 * presence channels. We expose `/api/pusher/auth` which uses Clerk to
 * verify the user, then signs based on what they're allowed to
 * subscribe to (their own user id, the dashboards for their role,
 * and any case they have permission to view).
 *
 * Fail-soft: if PUSHER_* env vars aren't set we no-op so dev still
 * works. The client-side hook handles the missing-config case too.
 */

import Pusher from 'pusher'
import { logger } from './logger'

let _server: Pusher | null = null
function server(): Pusher | null {
  if (_server) return _server
  const appId   = process.env.PUSHER_APP_ID
  const key     = process.env.NEXT_PUBLIC_PUSHER_KEY
  const secret  = process.env.PUSHER_SECRET
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'eu'
  if (!appId || !key || !secret) return null
  _server = new Pusher({ appId, key, secret, cluster, useTLS: true })
  return _server
}

/* ─── Channel name builders ───────────────────────────────────────── */

export const channels = {
  case:      (caseId: string) => `private-case-${caseId}`,
  dashboard: (role:   string) => `presence-dashboard-${role.toLowerCase()}`,
  user:      (userId: string) => `private-user-${userId}`,
} as const

/* ─── Event broadcasters ──────────────────────────────────────────── */

/** Broadcast a case-status change to the case channel and the
 *  relevant role's dashboard. Fire-and-forget; never throws. */
export async function broadcastCaseUpdate(args: {
  caseId:    string
  toStatus?: string
  role?:     string
  type:      'status_change' | 'comment' | 'photo_uploaded' | 'mechanic_assigned'
  payload?:  Record<string, unknown>
}): Promise<void> {
  const p = server()
  if (!p) return
  try {
    await p.trigger(
      [channels.case(args.caseId), ...(args.role ? [channels.dashboard(args.role)] : [])],
      args.type,
      { caseId: args.caseId, toStatus: args.toStatus, ...args.payload },
    )
  } catch (err) {
    logger.warn({ err, args }, 'pusher broadcast failed')
  }
}

/** Personal notification to one user. */
export async function broadcastUserNotification(args: {
  userId:  string
  title:   string
  body?:   string
  url?:    string
}): Promise<void> {
  const p = server()
  if (!p) return
  try {
    await p.trigger(channels.user(args.userId), 'notification', args)
  } catch (err) {
    logger.warn({ err, args }, 'pusher user notify failed')
  }
}

/** Used by /api/pusher/auth to sign channel subscriptions. */
export function authorizeChannel(
  socketId:    string,
  channel:     string,
  presenceData?: { user_id: string; user_info?: Record<string, unknown> },
) {
  const p = server()
  if (!p) {
    return { auth: '', channel_data: undefined as string | undefined }
  }
  if (channel.startsWith('presence-') && presenceData) {
    return p.authorizeChannel(socketId, channel, presenceData)
  }
  return p.authorizeChannel(socketId, channel)
}
