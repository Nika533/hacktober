import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: { trace: 'retain-on-failure' }
})
