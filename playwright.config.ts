import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/artifacts',
  timeout: 60000,
  retries: 0,
  use: {
    trace: 'off'
  }
})
