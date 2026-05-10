/**
 * Trigger.dev scheduled task — `daily-stale-check`.
 *
 * Runs every day at 07:00 Europe/London. Finds cases that have been
 * sitting in the same internal status for more than 5 business days
 * and pings the case owner via the in-app `Notification` table (the
 * bell icon in the topbar — NOT the customer-facing
 * `CustomerNotification` table).
 *
 * "Same status" is determined from CaseStatusHistory: we look at the
 * most recent transition for each active case and check if its
 * `createdAt` is more than 5 days old.
 *
 * "Owner" rules:
 *   - cases assigned to a mechanic → that mechanic
 *   - cases in CS / inbound stages → assigned via role lookup; we
 *     ping every CS / WAREHOUSE user (small team, fine to broadcast)
 *
 * Idempotent: if a notification already exists for the same case +
 * recipient + day, skip — so re-running the task in the same day
 * doesn't spam.
 */

import { logger, schedules } from '@trigger.dev/sdk/v3'
import { prisma } from '@/lib/prisma'
import { differenceInBusinessDays, startOfDay } from 'date-fns'

type SchedulePayload = { timestamp: Date; lastTimestamp?: Date }

const STALE_THRESHOLD_BUSINESS_DAYS = 5

const ACTIVE_STATUSES = [
  'AWAITING_INBOUND', 'INBOUND_DIAGNOSIS', 'AWAITING_CS', 'CS_RECHARGE',
  'WAITING_FOR_MECHANIC', 'IN_REPAIR', 'AWAITING_PARTS',
  'QC_FAILED', 'QUALITY_CONTROL', 'READY_TO_SHIP',
]

export const dailyStaleCheck = schedules.task({
  id:        'daily-stale-check',
  // 07:00 Europe/London (winter UTC=07; summer BST=06 — Trigger.dev
  // handles the cron in UTC so we use the winter time and accept a
  // slight summer drift; adjust the rule when DST flips).
  cron:      '0 7 * * *',
  maxDuration: 5 * 60,
  run: async (payload: SchedulePayload) => {
    logger.info('daily-stale-check start', { scheduledAt: payload.timestamp })

    const today = startOfDay(new Date())

    const activeCases = await prisma.repairOrder.findMany({
      where:  { status: { in: ACTIVE_STATUSES as never[] } },
      select: {
        id:          true,
        orderNumber: true,
        status:      true,
        mechanicId:  true,
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take:    1,
          select:  { createdAt: true, toStatus: true },
        },
      },
    })

    const stale = activeCases.filter((c) => {
      const last = c.statusHistory[0]?.createdAt ?? null
      if (!last) return false
      return differenceInBusinessDays(today, last) >= STALE_THRESHOLD_BUSINESS_DAYS
    })

    logger.info('daily-stale-check found', { stale: stale.length })

    let notificationsCreated = 0
    for (const c of stale) {
      // Recipients: the assigned mechanic + every CS/MANAGER/ADMIN user.
      const ids = new Set<string>()
      if (c.mechanicId) ids.add(c.mechanicId)
      const csManagers = await prisma.user.findMany({
        where:  { role: { in: ['CS', 'MANAGER', 'ADMIN'] }, isActive: true },
        select: { id: true },
      })
      csManagers.forEach((u) => ids.add(u.id))

      const last = c.statusHistory[0]
      const days = last ? differenceInBusinessDays(today, last.createdAt) : 0

      for (const recipientId of ids) {
        // Idempotency: skip if we've already nudged this user about
        // this case within the past 24h.
        const existing = await prisma.notification.findFirst({
          where: {
            recipientId,
            caseId:    c.id,
            kind:      'STALE_CASE',
            createdAt: { gte: today },
          },
          select: { id: true },
        })
        if (existing) continue

        await prisma.notification.create({
          data: {
            recipientId,
            caseId: c.id,
            kind:   'STALE_CASE',
            title:  `${c.orderNumber} has been in ${c.status} for ${days} days`,
            body:   `Last status change was ${days} business days ago.`,
            url:    `/cases/${c.id}`,
          },
        })
        notificationsCreated++
      }
    }

    logger.info('daily-stale-check done', { notificationsCreated })
    return { stale: stale.length, notificationsCreated }
  },
})
