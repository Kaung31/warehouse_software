import { test, expect } from '@playwright/test'

/**
 * E2E: customer tracking portal — happy path + bad-creds path.
 *
 * Assumes the seeded fixtures from `prisma/seed.ts`:
 *   - RO-000001 belongs to James Wilson, james@mail.com / 07700900001
 */

test('customer can look up their repair via email', async ({ page }) => {
  await page.goto('/track')

  await expect(page.getByRole('heading', { name: 'Track your repair' })).toBeVisible()

  await page.getByPlaceholder(/RO-/).fill('RO-000001')
  await page.getByPlaceholder(/example/).fill('james@mail.com')
  await page.getByRole('button', { name: /Look up my repair/i }).click()

  await expect(page).toHaveURL(/\/track\/RO-000001\?token=/)
  await expect(page.getByText(/Pure Air Pro/)).toBeVisible()
  await expect(page.getByText(/Estimated/i)).toBeVisible()
})

test('customer can look up their repair via phone last-4', async ({ page }) => {
  await page.goto('/track')
  await page.getByPlaceholder(/RO-/).fill('RO-000001')
  await page.getByPlaceholder(/example/).fill('0001')
  await page.getByRole('button', { name: /Look up my repair/i }).click()
  await expect(page).toHaveURL(/\/track\/RO-000001\?token=/)
})

test('bad credentials produce a generic error', async ({ page }) => {
  await page.goto('/track')
  await page.getByPlaceholder(/RO-/).fill('RO-000001')
  await page.getByPlaceholder(/example/).fill('not-the-right-email@example.com')
  await page.getByRole('button', { name: /Look up my repair/i }).click()
  await expect(page.getByText(/Couldn't find a matching repair/i)).toBeVisible()
})
