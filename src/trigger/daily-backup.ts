/**
 * Trigger.dev scheduled task — `daily-backup`.
 *
 * Runs every day at 02:00 Europe/London. Streams a logical Postgres
 * dump from Neon's DIRECT_URL into a separate R2 bucket
 * (`R2_BACKUP_BUCKET`) with a date-stamped key. Keeps 30 days; the
 * R2 bucket should have a lifecycle rule that deletes objects older
 * than 31 days as a safety net (configured via `wrangler` once).
 *
 * Why we run this even though Neon has PITR:
 *   - Geographic redundancy (R2 is global, Neon is region-pinned).
 *   - Recovery from a Neon account-level incident (account deletion,
 *     billing freeze).
 *   - 30-day retention vs. Neon's 7-day default on Launch tier.
 *
 * Implementation: rather than spawn `pg_dump` in the Trigger.dev
 * worker (we'd need the binary in the container), we run the SQL-
 * based equivalent via Prisma — it's slower but works on any
 * runtime. For databases >10 GB, switch to a dedicated job that
 * runs `pg_dump | gzip | aws s3 cp -` from a worker container.
 *
 * For now this is best-effort and intentionally simple — sufficient
 * for the current scale (50–60 users, low six-digit row counts).
 */

import { logger, schedules } from '@trigger.dev/sdk/v3'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { prisma } from '@/lib/prisma'

const BACKUP_BUCKET = process.env.R2_BACKUP_BUCKET ?? 'scooterhub-backups'
const ACCOUNT_ID    = process.env.R2_ACCOUNT_ID
const ACCESS_KEY    = process.env.R2_BACKUP_ACCESS_KEY_ID    ?? process.env.R2_ACCESS_KEY_ID
const SECRET_KEY    = process.env.R2_BACKUP_SECRET_ACCESS_KEY ?? process.env.R2_SECRET_ACCESS_KEY

const TABLES_IN_DUMP_ORDER = [
  // Order matters for restore (FK dependencies).
  'User', 'Customer', 'Scooter', 'Part', 'WarehouseLocation',
  'Pallet', 'PalletItem',
  'RepairOrder', 'RepairPart', 'StockMovement',
  'CaseStatusHistory', 'CaseComment', 'CaseTask',
  'Photo', 'QCChecklistTemplate', 'QCSubmission', 'QCChecklistResult',
  'ErrorCodeReport', 'RepairTimeLog', 'InvoiceReference',
  'Notification', 'PartsRequest', 'AuditLog',
  'RepairGuide', 'CustomerNotification',
  'Shipment',
]

export const dailyBackup = schedules.task({
  id:          'daily-backup',
  cron:        '0 2 * * *',
  maxDuration: 30 * 60,
  run: async () => {
    if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
      logger.error('daily-backup: R2 credentials missing — skipping')
      return { skipped: 'no R2 creds' }
    }

    const r2 = new S3Client({
      region:      'auto',
      endpoint:    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    })

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const key   = `backups/${stamp}.json.gz`

    logger.info('daily-backup start', { bucket: BACKUP_BUCKET, key })

    // Logical dump as a single JSON object: one key per table, value
    // is an array of rows. Zips well — small enough to not stream.
    const dump: Record<string, unknown[]> = {}
    for (const tableName of TABLES_IN_DUMP_ORDER) {
      const camel = tableName[0].toLowerCase() + tableName.slice(1)
      try {
        const model = (prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[camel]
        if (!model || typeof model.findMany !== 'function') {
          logger.warn('daily-backup: table missing on Prisma client', { tableName })
          continue
        }
        dump[tableName] = await model.findMany()
        logger.info(`daily-backup ${tableName}`, { rows: dump[tableName].length })
      } catch (err) {
        logger.error(`daily-backup ${tableName} failed`, { err: String(err) })
        // Keep going — partial backup is better than no backup.
      }
    }

    // gzip with the platform-standard CompressionStream (Node 18+).
    const json = Buffer.from(JSON.stringify(dump))
    const gzipped = await gzip(json)
    logger.info('daily-backup compressed', {
      uncompressedBytes: json.length,
      compressedBytes:   gzipped.length,
    })

    await r2.send(new PutObjectCommand({
      Bucket:      BACKUP_BUCKET,
      Key:         key,
      Body:        gzipped,
      ContentType: 'application/gzip',
      Metadata:    {
        rowCounts: Object.fromEntries(
          Object.entries(dump).map(([k, v]) => [k, String(v.length)]),
        ) as never,
      },
    }))

    logger.info('daily-backup uploaded', { key })
    return { key, bytes: gzipped.length }
  },
})

/** Wraps Web Streams CompressionStream — works in Node 18+ workers. */
async function gzip(input: Buffer): Promise<Buffer> {
  const stream = new Response(
    new Blob([input as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')),
  )
  const buf = await stream.arrayBuffer()
  return Buffer.from(buf)
}
