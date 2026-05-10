/**
 * Vitest config for integration tests.
 *
 * Why a separate config from vitest.config.ts:
 *   - Real DB. Each test file truncates business + audit tables, so
 *     parallel files would race. We pin to a single fork.
 *   - Heavier setup (prisma client, mocked external services). The
 *     unit suite stays fast.
 *   - DATABASE_URL must point at a Neon CI branch (or a local
 *     Postgres that has the migrations applied). The setup file
 *     refuses to run otherwise.
 *
 * Run:
 *   DATABASE_URL=postgresql://… npx vitest --config vitest.integration.config.ts run
 *   or:
 *   npm run test:integration
 */

import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment:    'node',
    globals:        false,
    setupFiles:     ['./tests/integration/setup.ts'],
    include:        ['tests/integration/**/*.test.ts'],
    // Sequential execution — every test mutates real tables. Parallel
    // workers would step on each other. Single fork keeps it simple
    // and the suite small enough that wall-clock is fine.
    pool:           'forks',
    poolOptions:    { forks: { singleFork: true } },
    fileParallelism: false,
    // Real DB round-trips + tx commits — give it room.
    testTimeout:    30_000,
    hookTimeout:    30_000,
  },
  resolve: {
    alias: {
      '@/': path.join(__dirname, 'src') + '/',
      '@':  path.join(__dirname, 'src'),
    },
  },
})
