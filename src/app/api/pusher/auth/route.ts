import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, requireAuth, apiError } from '@/lib/api-helpers'
import { authorizeChannel } from '@/lib/pusher'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/pusher/auth
 *
 * Pusher's standard auth-endpoint contract: Pusher sends
 * `socket_id` + `channel_name` as form data, we verify the user has
 * permission to subscribe to that channel, then return a signed
 * payload.
 *
 * Authorisation rules:
 *   - private-user-<userId>             only `userId === clerk userId`
 *   - presence-dashboard-<role>         user's role matches (or
 *                                       ADMIN/MANAGER who see all)
 *   - private-case-<caseId>             user has visibility on the case
 *                                       (mechanic = assigned, CS/admin
 *                                       /manager = always, warehouse =
 *                                       always for now)
 */

export const POST = withErrorHandler(async (req: NextRequest) => {
  const user = await requireAuth() // Clerk

  const form     = await req.formData()
  const socketId = String(form.get('socket_id'))
  const channel  = String(form.get('channel_name'))

  if (!socketId || !channel) return apiError('Missing socket_id / channel_name', 400)

  // ── private-user-<userId> ──────────────────────────────────────────
  if (channel.startsWith('private-user-')) {
    const userId = channel.slice('private-user-'.length)
    if (userId !== user.id) return apiError('Forbidden', 403)
    return NextResponse.json(authorizeChannel(socketId, channel))
  }

  // ── presence-dashboard-<role> ──────────────────────────────────────
  if (channel.startsWith('presence-dashboard-')) {
    const targetRole = channel.slice('presence-dashboard-'.length).toUpperCase()
    if (
      user.role !== targetRole &&
      user.role !== 'ADMIN' &&
      user.role !== 'MANAGER'
    ) {
      return apiError('Forbidden', 403)
    }
    return NextResponse.json(
      authorizeChannel(socketId, channel, {
        user_id:   user.id,
        user_info: { name: user.name, role: user.role },
      }),
    )
  }

  // ── private-case-<caseId> ──────────────────────────────────────────
  if (channel.startsWith('private-case-')) {
    const caseId = channel.slice('private-case-'.length)

    if (['ADMIN', 'MANAGER', 'CS', 'WAREHOUSE'].includes(user.role)) {
      return NextResponse.json(authorizeChannel(socketId, channel))
    }
    if (user.role === 'MECHANIC') {
      const c = await prisma.repairOrder.findUnique({
        where:  { id: caseId },
        select: { mechanicId: true, status: true },
      })
      if (!c) return apiError('Case not found', 404)
      const mine     = c.mechanicId === user.id
      const claimable =
        c.mechanicId === null && c.status === 'WAITING_FOR_MECHANIC'
      if (!mine && !claimable) return apiError('Forbidden', 403)
      return NextResponse.json(authorizeChannel(socketId, channel))
    }
  }

  return apiError('Unknown channel', 400)
})
