import { defineConfig } from 'vitest/config'

// Each workspace folder with a vitest config is its own project.
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      {
        test: {
          name: 'tooling',
          include: ['scripts/**/*.test.mjs'],
          environment: 'node'
        }
      }
    ],
    passWithNoTests: true
  }
})
