#!/usr/bin/env tsx
/**
 * scripts/neon-reset.ts
 *
 * Delete the developer's current branch (whatever DATABASE_URL points
 * at) and re-create from the parent. Useful for "I broke my schema,
 * just give me a clean copy."
 *
 * Pass --branch-id to override the deletion target.
 */

const API_KEY    = process.env.NEON_API_KEY
const PROJECT_ID = process.env.NEON_PROJECT_ID

if (!API_KEY || !PROJECT_ID) {
  console.error('Error: NEON_API_KEY and NEON_PROJECT_ID must be set in .env')
  process.exit(1)
}

const args      = process.argv.slice(2)
const branchId  = args[args.indexOf('--branch-id') + 1]

if (!branchId || branchId.startsWith('--')) {
  console.error(`Usage: npm run db:reset:dev -- --branch-id <id>

Find your branch id in the Neon dashboard or via:
  curl -H "Authorization: Bearer $NEON_API_KEY" \\
    https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches`)
  process.exit(1)
}

async function main() {
  console.log(`Deleting branch ${branchId}…`)
  const res = await fetch(
    `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/branches/${branchId}`,
    {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' },
    },
  )
  if (!res.ok) {
    console.error(`Neon API error: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  console.log('\n✓ Branch deleted.')
  console.log('Run `npm run db:branch` to create a fresh one.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
