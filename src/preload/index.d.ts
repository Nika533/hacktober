import type { HootApi } from './index'

declare global {
  interface Window {
    hoot: HootApi
  }
}

export {}
