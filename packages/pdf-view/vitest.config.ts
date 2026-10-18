import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'pdf-view',
    include: ['tests/**/*.test.ts'],
    // Pure reflow and DOM rendering run in happy-dom; the PDF.js test opts
    // into Node with a file-level environment comment.
    environment: 'happy-dom'
  }
})
