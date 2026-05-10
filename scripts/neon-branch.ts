#!/usr/bin/env tsx
/**
 * scripts/neon-branch.ts
 *
 * Create a Neon branch off `production` for local development. Prints
 * the new branch's pooled + unpooled connection URLs so the dev can
 * paste them into `.env`. Branch name defaults to your git username
 * + a short timestamp; pass --name to override.
 *
 * Requires: NEON_API_KEY + NEON_PROJECT_ID env vars.
 *
 * Usage:
 *   npm run db:branch -- --name kai-feat-foo
 *
 * Neon API docs: https://api-docs.neon.tech/reference/createprojectbranch
 */

import { execSync } from 'node:child_process'

const API_KEY    = process.env.NEON_API_KEY
const PROJECT_ID = process.env.NEON_PROJECT_ID

if (!API_KEY || !PROJECT_ID) {
  console.error('Error: NEON_API_KEY and NEON_PROJECT_ID must be set in .env')
  process.exit(1)
}

const args  = process.argv.slice(2)
const flag  = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const username = flag('name') ?? safeGitUser()
const stamp    = new Date().toISOString().slice(2, 16).replace(/[-:T]/g, '')
const name     = `dev/${username}-${stamp}`

async function main() {
  console.log(`Creating branch ${name} on project ${PROJECT_ID}…`)

  const res = await fetch(
    `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/branches`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        branch:    { name, parent_id: undefined }, // omit = parent off main
        endpoints: [{ type: 'read_write' }],
      }),
    },
  )
  if (!res.ok) {
    console.error(`Neon API error: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  const json = (await res.json()) as {
    branch:    { id: string; name: string }
    endpoints: { host: string; type: string }[]
  }

  const endpoint = json.endpoints[0]
  if (!endpoint) {
    console.error('Branch created but no endpoint returned. Check Neon dashboard.')
    process.exit(1)
  }

  console.log('\n✓ Branch created.')
  console.log(`  name:     ${json.branch.name}`)
  console.log(`  id:       ${json.branch.id}`)
  console.log(`  endpoint: ${endpoint.host}\n`)
  console.log('Add to your .env:\n')
  console.log(`  DATABASE_URL=postgres://<user>:<password>@${endpoint.host}/<db>?sslmode=require&pgbouncer=true&connect_timeout=10`)
  console.log(`  DIRECT_URL=postgres://<user>:<password>@${endpoint.host}/<db>?sslmode=require`)
  console.log('\nYou can grab the user/password from the Neon dashboard.\n')
}

function safeGitUser(): string {
  try {
    return execSync('git config user.name', { encoding: 'utf8' })
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
  } catch {
    return 'dev'
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
