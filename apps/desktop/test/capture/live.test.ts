import { DEFAULT_SETTINGS, LIVE_SCREEN_NOTE, type Rect } from '@hoot/core'
import { describe, expect, it, vi } from 'vitest'
import { createCaptureService, type CaptureImage } from '../../src/main/capture'
import type { ScreenGrabber } from '../../src/main/capture/grab'
import type { OverlayHost } from '../../src/main/capture/overlay'
import type { Logger } from '../../src/main/log'
import type { Persistence } from '../../src/main/store/persistence'
import { createStore, initialSlices } from '../../src/main/store/store'
import type { WindowRegistry } from '../../src/main/windows/base'

vi.mock('electron', () => ({}))

/** The live overlay (C): open over the real screen, chat in place, a fresh frame per message. */

const noop = (): void => undefined
const silent: Logger = { info: noop, warn: noop, error: noop }
const DISPLAY: Rect = { x: 0, y: 0, width: 1500, height: 1000 }

class FakeImage implements CaptureImage {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly tag: string,
    readonly ops: string[]
  ) {}
  isBlank(): boolean {
    return false
  }
  crop(r: Rect): CaptureImage {
    this.ops.push(`crop ${this.tag} ${r.x},${r.y} ${r.width}x${r.height}`)
    return new FakeImage(r.width, r.height, this.tag, this.ops)
  }
  resize(width: number, height: number): CaptureImage {
    return new FakeImage(width, height, this.tag, this.ops)
  }
  toJpegDataUrl(): string {
    return 'data:image/jpeg;base64,AAAA'
  }
  toPng(): Uint8Array {
    return new Uint8Array([1])
  }
  toPngDataUrl(): string {
    return `data:image/png;base64,${this.tag}`
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup(opts: { live?: boolean; studioVisible?: boolean } = {}) {
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
  const ops: string[] = []
  const events: string[] = []
  const deleted: string[] = []
  let grabs = 0
  const grabber: ScreenGrabber = {
    async grab(displayId) {
      grabs += 1
      events.push(`grab ${displayId ?? 'cursor'}`)
      return {
        image: new FakeImage(3000, 2000, `g${grabs}`, ops),
        display: { id: 7, bounds: DISPLAY }
      }
    },
    prewarm: noop
  }
  const overlay: OverlayHost & { hidden: number } = {
    hidden: 0,
    prepare: noop,
    show: () => void events.push('show'),
    hide: () => {
      overlay.hidden += 1
      events.push('hide')
    },
    setCaptureExcluded: (on) => void events.push(`excluded ${on}`)
  }
  const studioOpen = vi.fn<(view?: string) => void>()
  const restore = vi.fn<(added: boolean) => void>()
  const newChat = vi.fn(() => {
    events.push('newChat')
    store.update('chat', { session: null, pendingAttachments: [] })
  })
  let ids = 0
  const capture = createCaptureService({
    store,
    windows: {
      get: () => ({ hide: noop }),
      set: noop,
      all: () => []
    } as unknown as WindowRegistry,
    studio: { open: studioOpen, isVisible: () => opts.studioVisible ?? false },
    persistence: {
      saveAttachment: async () => undefined,
      deleteAttachment: async (id: string) => void deleted.push(id)
    } as unknown as Persistence,
    log: silent,
    surfaces: { hide: noop, restore },
    grabber,
    overlay,
    live: opts.live ?? true,
    newChat,
    notify: noop,
    wait: async () => undefined,
    newId: () => `a${++ids}`,
    now: () => 42
  })
  const pending = (): string[] => store.get('chat').pendingAttachments.map((a) => a.thumbDataUrl)
  return { store, capture, overlay, events, ops, pending, studioOpen, restore, newChat, deleted }
}

describe('live capture overlay', () => {
  it('shows the real screen (no still) and stays open after a commit, with a fresh chat', async () => {
    const t = setup()
    await t.capture.start('lasso')
    expect(t.capture.getInit()?.imageDataUrl).toBe('')

    await t.capture.commit({ kind: 'rect', rect: { x: 100, y: 100, width: 200, height: 100 } })
    expect(t.overlay.hidden).toBe(0)
    expect(t.capture.isCapturing()).toBe(true)
    expect(t.newChat).toHaveBeenCalledTimes(1)
    // The first shape is cut from the grab taken before the overlay showed.
    expect(t.ops).toEqual(['crop g1 200,200 400x200'])
    expect(t.pending()).toHaveLength(1)
    expect(t.capture.getInit()).not.toBeNull()
  })

  it('a redraw starts a new chat from a new grab, taken without the overlay in it', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    t.events.length = 0
    await t.capture.commit({ kind: 'rect', rect: { x: 0, y: 0, width: 50, height: 50 } })
    // The new chat first, so the old conversation never shows over the new shape.
    expect(t.events).toEqual(['newChat', 'excluded true', 'grab 7', 'excluded false'])
    expect(t.ops.at(-1)).toBe('crop g2 0,0 100x100')
    expect(t.pending()).toHaveLength(1)
  })

  it('attaches the current full screen before each message and returns the note', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
    t.events.length = 0
    expect(await t.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
    expect(t.events).toEqual(['excluded true', 'grab 7', 'excluded false'])
    // The circled region first, then the live screen: the model is told the last image is the screen.
    expect(t.pending()).toEqual(['data:image/png;base64,g1', 'data:image/png;base64,g2'])
  })

  it('attaches nothing when no live overlay is open, or outside live mode', async () => {
    const closed = setup()
    expect(await closed.capture.attachLiveScreen()).toBeNull()

    const still = setup({ live: false })
    await still.capture.start()
    expect(still.capture.getInit()?.imageDataUrl).toMatch(/^data:image\/jpeg/)
    expect(await still.capture.attachLiveScreen()).toBeNull()
  })

  it('closes without the card: the owl comes back, or Studio on the view it was on', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    await t.capture.cancel()
    expect(t.overlay.hidden).toBe(1)
    expect(t.capture.isCapturing()).toBe(false)
    expect(t.restore).toHaveBeenCalledWith(false)
    expect(t.studioOpen).not.toHaveBeenCalled()
    expect(await t.capture.attachLiveScreen()).toBeNull()

    // Started from Studio (or onboarding): Studio comes back, never left hidden.
    const fromStudio = setup({ studioVisible: true })
    fromStudio.store.update('studio', { view: 'onboarding' })
    await fromStudio.capture.start()
    await fromStudio.capture.cancel()
    expect(fromStudio.studioOpen).toHaveBeenCalledWith('onboarding')
    expect(fromStudio.restore).not.toHaveBeenCalled()
  })

  it('drops what it attached but never sent when it closes', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
    await t.capture.attachLiveScreen()
    expect(t.pending()).toHaveLength(2)
    await t.capture.cancel()
    expect(t.pending()).toEqual([])
    expect(t.deleted).toHaveLength(2)
  })

  it('keeps the overlay out of the picture until the last of overlapping grabs ends', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    t.events.length = 0
    await Promise.all([t.capture.attachLiveScreen(), t.capture.attachLiveScreen()])
    expect(t.events.filter((e) => e.startsWith('excluded'))).toEqual([
      'excluded true',
      'excluded false'
    ])
  })
})
