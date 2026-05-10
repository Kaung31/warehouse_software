import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals:     false,
    setupFiles:  ['./tests/unit/setup.ts'],
    include:     ['tests/unit/**/*.test.ts'],
    coverage: {
      provider:  'v8',
      reporter:  ['text', 'html', 'lcov'],
      include:   ['src/lib/**/*.ts'],
      exclude:   ['src/lib/prisma.ts', 'src/lib/r2.ts'],
    },
  },
  resolve: {
    alias: {
      '@/': path.join(__dirname, 'src') + '/',
      '@':  path.join(__dirname, 'src'),
    },
  },
})
