import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/artifacts',
  timeout: 60_000,
  retries: 0,
  use: { trace: 'retain-on-failure' }
})
