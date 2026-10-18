import { DEFAULT_SETTINGS, HOOT_API_ROUTES } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import {
  createCaptureHandlers,
  createCaptureService,
  type CaptureService
} from '../../src/main/capture'
import type { Logger } from '../../src/main/log'
import type { Persistence } from '../../src/main/store/persistence'
import { createStore, initialSlices, type Store } from '../../src/main/store/store'
import type { WindowRegistry } from '../../src/main/windows/base'

const noop = (): void => undefined
const silent: Logger = { info: noop, warn: noop, error: noop }

function setup(): { store: Store; capture: CaptureService } {
  const store = createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: false,
      keyStorage: 'memory',
      system: {
        platform: 'win32',
        version: '0.0.0',
        packaged: false,
        accentColor: '#0078d4',
        darkMode: false,
        highContrast: false
      }
    })
  )
  const windows: WindowRegistry = { get: () => undefined, set: noop, all: () => [] }
  const capture = createCaptureService({
    store,
    windows,
    studio: { open: noop, isVisible: () => false },
    persistence: {} as Persistence,
    log: silent
  })
  return { store, capture }
}

describe('capture skeleton (F-D2-0)', () => {
  it('has a handler for every capture invoke channel', () => {
    const { capture } = setup()
    const invokes = Object.values(HOOT_API_ROUTES.capture)
      .filter((route) => route.kind === 'invoke')
      .map((route) => route.channel)
      .sort()
    expect(Object.keys(createCaptureHandlers(capture)).sort()).toEqual(invokes)
  })

  it('does nothing until the overlay lands', async () => {
    const { store, capture } = setup()
    const handlers = createCaptureHandlers(capture)
    const before = store.get('chat')
    await handlers['capture:start']('rect')
    expect(capture.isCapturing()).toBe(false)
    expect(await handlers['capture:getInit']()).toBeNull()
    await handlers['capture:commit']({ kind: 'full' })
    await handlers['capture:cancel']()
    capture.prewarm()
    expect(store.get('chat')).toBe(before)
  })
})
