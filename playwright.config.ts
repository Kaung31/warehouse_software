import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — UK-based business app.
 *
 * Local: starts `npm run dev` and runs against it.
 * CI:    expects the test job to have its own server up
 *        (Neon branch + npm run dev are set up in the workflow).
 */

const PORT = process.env.PORT ?? '3000'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir:        './tests/e2e',
  fullyParallel:  true,
  retries:        process.env.CI ? 2 : 0,
  workers:        process.env.CI ? 1 : undefined,
  reporter:       process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL:        BASE_URL,
    trace:          'on-first-retry',
    screenshot:     'only-on-failure',
    actionTimeout:  10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: process.env.CI
    ? undefined
    : {
        command:        'npm run dev',
        url:            BASE_URL,
        timeout:        120_000,
        reuseExistingServer: true,
      },
})
