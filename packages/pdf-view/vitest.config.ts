import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'pdf-view',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'happy-dom'
  }
})
