# ScooterHub — developer onboarding

Day-one setup for a new dev. Aim: laptop → running tests in
under 30 minutes.

## Prerequisites

- Node 20.x (`nvm install 20 && nvm use 20`)
- A Neon account with access to the ScooterHub project (ask Kai)
- The shared `.env.example` to copy from (`cp .env.example .env`)

## Steps

### 1. Clone + install

```sh
git clone git@github.com:scooterhub/scooterhub.git
cd scooterhub
npm install
npx playwright install --with-deps chromium   # only if you'll run E2E
```

### 2. Get a personal Neon branch

You don't share databases with other devs. Each of us gets our own
branch off `production`.

```sh
# After populating NEON_API_KEY + NEON_PROJECT_ID in .env:
npm run db:branch
# Copy the printed DATABASE_URL + DIRECT_URL into your .env.
```

If you'd rather use the Neon dashboard: project → Branches → create
branch → copy the pooled and unpooled URLs.

### 3. Run migrations + seed

```sh
npx prisma migrate deploy
npx prisma db seed
```

Seed creates 6 users, 6 customers, 12 scooters, 12 cases (across every
pipeline stage), 7 repair guides, 6 sample customer notifications.
Test credentials are printed at the end.

### 4. Bring up the dev server

```sh
npm run dev
# http://localhost:3000
```

The first request will fail-soft on every external service that isn't
configured (Sentry / PostHog / Pusher / Trigger.dev). You can keep
those blank locally — the app works without them.

### 5. (Optional) Run the worker

For testing background jobs locally without Trigger.dev's cloud:

```sh
npx trigger dev
```

This boots a local Trigger.dev runner. You'll need a free
[trigger.dev](https://trigger.dev) project; ask Kai for the dev project
secrets.

If you skip this, every `enqueue('xyz', ...)` falls back to running
the task body inline — slower (especially Resend sends) but
functional.

## What environments map to what

| env             | DATABASE_URL                | what it is                         |
| --------------- | --------------------------- | ---------------------------------- |
| local           | your personal Neon branch   | yours alone, reset whenever        |
| PR              | `pr-<n>` Neon branch        | created automatically by CI        |
| staging         | `staging` Neon branch       | always-on, mirrors production      |
| production      | `production` Neon branch    | the real thing                     |

## Useful commands

```sh
npm run dev                  # Next.js dev server
npm run build                # production build
npm run lint                 # eslint
npm run test                 # vitest unit tests
npm run test:watch           # vitest in watch mode
npm run test:e2e             # Playwright (requires the dev server up)
npm run test:e2e:ui          # Playwright headed mode

npm run db:branch            # create a Neon branch
npm run db:migrate:staging   # deploy migrations to the staging branch
npm run db:reset:dev -- --branch-id <id>

npm run trigger:dev          # local Trigger.dev runner
npm run trigger:deploy       # deploy tasks to Trigger.dev cloud

npx prisma studio            # browse + edit your branch's data
npx prisma migrate dev       # create a new migration locally
npx prisma generate          # regenerate the Prisma client (auto on install)
```

## Code conventions (very important)

- Server components fetch via Prisma; client components own
  `useState` + `fetch`.
- Decimals → `Number()` before crossing the server→client boundary.
- Dates → ISO strings before crossing.
- Every status mutation writes a `CaseStatusHistory` row in the
  same transaction.
- Verb-style API endpoints, not REST CRUD.
- Zod `parseBody` at every API boundary.
- Per-button `loading` state, never a single shared `busy`.
- Manual date formatting (`MONTHS[d.getMonth()]`) — never
  `toLocaleString` (hydration mismatch).
- Inline SVG icons, 1.6–1.8 px stroke. No emojis (except seed.ts
  console output).
- Pure CSS in `src/app/globals.css`. No Tailwind.
- Notifications go through `enqueue('notify-status-change', ...)`
  — never call `notifyStatusChange()` directly from a route.

See `docs/architecture.md` for the bigger picture and
`docs/runbook/index.md` for "what to do when X breaks".
