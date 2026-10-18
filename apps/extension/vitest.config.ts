import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'extension',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableIframePageLoading: true,
          handleDisabledFileLoadingAsSuccess: true
        }
      }
    }
  }
})
