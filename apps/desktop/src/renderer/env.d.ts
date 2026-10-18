import type { HootApi } from '@hoot/core'

declare global {
  interface Window {
    hoot: HootApi
  }
}

export {}
