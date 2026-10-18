import { defineConfig } from 'vitest/config'

// Rewrite-quality evals (C-31): `npm run eval` from the repo root.
export default defineConfig({
  test: {
    name: 'desktop-eval',
    root: import.meta.dirname,
    include: ['evals/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30 * 60_000
  }
})
