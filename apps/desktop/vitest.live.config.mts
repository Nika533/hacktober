import { defineConfig } from 'vitest/config'

// Real Gemini calls. Run from the repo root with `npm run test:live`;
// every test skips itself when GEMINI_API_KEY is unset.
export default defineConfig({
  test: {
    name: 'desktop-live',
    root: import.meta.dirname,
    include: ['test-live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000
  }
})
