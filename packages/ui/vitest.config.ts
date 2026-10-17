import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'ui',
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts']
  }
})
