// Stable env for unit tests. Override per-test if needed via vi.stubEnv.
//
// We assign through a typed proxy because TS 5+ marks NODE_ENV
// readonly in @types/node — but it's still mutable at runtime, and
// Vitest sets it to 'test' before this file loads anyway.
const env = process.env as Record<string, string | undefined>
env.TRACK_TOKEN_SECRET ??= 'unit-test-secret-min-16-chars-long-enough'
env.NODE_ENV           ??= 'test'
