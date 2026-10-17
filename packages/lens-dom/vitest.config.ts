import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'lens-dom',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'happy-dom'
  }
})
