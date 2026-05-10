/**
 * Trigger.dev configuration.
 *
 * This file is the entry point for Trigger.dev — both `trigger dev`
 * (local) and `trigger deploy` (CI) read it. Tasks live in
 * `src/trigger/*` so they're co-located with the rest of the codebase
 * and share imports (Prisma client, lib helpers, etc).
 */

import { defineConfig } from '@trigger.dev/sdk/v3'

export default defineConfig({
  project:    process.env.TRIGGER_PROJECT_ID ?? 'proj_local',
  runtime:    'node',
  logLevel:   'info',
  // v4 made `maxDuration` required at the project level. This is the
  // hard cap for any task run; per-task `maxDuration` overrides it.
  // 5 minutes is comfortably above our longest expected task
  // (daily-backup, which streams a logical dump to R2).
  maxDuration: 5 * 60,
  // Retries — applied to every task unless overridden.
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts:        3,
      minTimeoutInMs:     1_000,
      maxTimeoutInMs:     30_000,
      factor:             2,
      randomize:          true,
    },
  },
  // Where Trigger.dev's CLI looks for tasks.
  dirs: ['./src/trigger'],
})
