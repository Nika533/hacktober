import { DEFAULT_SETTINGS, HOOT_API_ROUTES, type Attachment, type Rect } from '@hoot/core'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  createCaptureHandlers,
  createCaptureService,
  type CaptureImage,
  type CaptureService,
  type CaptureSurfaces
} from '../../src/main/capture'
import type { Grab, ScreenGrabber } from '../../src/main/capture/grab'
import type { OverlayHost } from '../../src/main/capture/overlay'
import { COPY, cropFor } from '../../src/main/capture/service'
import type { Logger } from '../../src/main/log'
import type { Persistence } from '../../src/main/store/persistence'
import { createStore, initialSlices, type Store } from '../../src/main/store/store'
import type { WindowRegistry } from '../../src/main/windows/base'

vi.mock('electron', () => ({}))

const noop = (): void => undefined
const silent: Logger = { info: noop, warn: noop, error: noop }
/** 1500×1000 DIP at 200 %: the image is 3000×2000. */
const DISPLAY: Rect = { x: 0, y: 0, width: 1500, height: 1000 }

class FakeImage implements CaptureImage {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly ops: string[] = [],
    private readonly blank = false
  ) {}
  isBlank(): boolean {
    return this.blank
  }
  crop(r: Rect): CaptureImage {
    this.ops.push(`crop ${r.x},${r.y} ${r.width}x${r.height}`)
    return new FakeImage(r.width, r.height, this.ops)
  }
  resize(width: number, height: number): CaptureImage {
    this.ops.push(`resize ${width}x${height}`)
    return new FakeImage(width, height, this.ops)
  }
  toJpegDataUrl(): string {
    return 'data:image/jpeg;base64,AAAA'
  }
  toPng(): Uint8Array {
    return new Uint8Array([1, 2, 3])
  }
  toPngDataUrl(): string {
    return `data:image/png;base64,${this.width}x${this.height}`
  }
}

interface Setup {
  store: Store
  capture: CaptureService
  ops: string[]
  grabs: () => number
  overlay: { shown: Rect[]; hidden: number; prepared: number }
  notes: string[]
  saved: string[]
  studioWin: { hide: Mock<() => void> }
  studioOpen: Mock<(view?: string) => void>
  surfaces: { hide: Mock<() => void | Promise<void>>; restore: Mock<(added: boolean) => void> }
  warmed: () => number
}

function setup(
  options: { blank?: boolean; studioVisible?: boolean; grab?: Grab | null } = {}
): Setup {
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
  let grabs = 0
  let warmed = 0
  const grabber: ScreenGrabber = {
    async grab() {
      grabs += 1
      if (options.grab !== undefined) return options.grab
      return {
        image: new FakeImage(3000, 2000, ops, options.blank),
        display: { id: 1, bounds: DISPLAY }
      }
    },
    prewarm: () => void (warmed += 1)
  }
  const overlayLog = { shown: [] as Rect[], hidden: 0, prepared: 0 }
  const overlay: OverlayHost = {
    prepare: () => void (overlayLog.prepared += 1),
    show: (bounds) => void overlayLog.shown.push(bounds),
    hide: () => void (overlayLog.hidden += 1)
  }
  const studioWin = { hide: vi.fn<() => void>() }
  const windows = {
    get: (kind: string) => (kind === 'studio' ? studioWin : undefined),
    set: noop,
    all: () => []
  } as unknown as WindowRegistry
  const studioOpen = vi.fn<(view?: string) => void>()
  const surfaces: CaptureSurfaces & Setup['surfaces'] = {
    hide: vi.fn<() => void | Promise<void>>(),
    restore: vi.fn<(added: boolean) => void>()
  }
  const notes: string[] = []
  const saved: string[] = []
  let ids = 0
  const capture = createCaptureService({
    store,
    windows,
    studio: { open: studioOpen, isVisible: () => options.studioVisible ?? false },
    persistence: {
      saveAttachment: async (id: string) => void saved.push(id)
    } as unknown as Persistence,
    log: silent,
    surfaces,
    grabber,
    overlay,
    notify: (message) => void notes.push(message),
    wait: async () => undefined,
    newId: () => `a${++ids}`,
    now: () => 42
  })
  return {
    store,
    capture,
    ops,
    grabs: () => grabs,
    overlay: overlayLog,
    notes,
    saved,
    studioWin,
    studioOpen,
    surfaces,
    warmed: () => warmed
  }
}

const pending = (store: Store): Attachment[] => store.get('chat').pendingAttachments

describe('capture service', () => {
  it('starts once when asked twice at the same time, and opens the overlay on the display', async () => {
    const { capture, grabs, overlay, surfaces } = setup()
    await Promise.all([capture.start('rect'), capture.start('lasso')])
    expect(grabs()).toBe(1)
    expect(overlay.shown).toEqual([DISPLAY])
    expect(surfaces.hide).toHaveBeenCalledOnce()
    expect(capture.isCapturing()).toBe(true)
    expect(capture.getInit()).toEqual({
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      displayWidth: 1500,
      displayHeight: 1000,
      mode: 'rect',
      accentColor: '#0078d4',
      pendingCount: 0
    })
    await capture.start()
    expect(grabs()).toBe(1)
  })

  it('crops a rectangle at the image’s own scale and adds it to the composer', async () => {
    const { capture, store, ops, saved, overlay, surfaces } = setup()
    await capture.start('rect')
    await capture.commit({ kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 100 } })
    expect(ops).toEqual(['crop 200,100 400x200', 'resize 160x80'])
    expect(saved).toEqual(['a1'])
    expect(pending(store)).toEqual([
      {
        id: 'a1',
        kind: 'capture',
        thumbDataUrl: 'data:image/png;base64,160x80',
        width: 400,
        height: 200,
        createdAt: 42
      }
    ])
    expect(overlay.hidden).toBe(1)
    expect(surfaces.restore).toHaveBeenCalledWith(true)
    expect(capture.isCapturing()).toBe(false)
    expect(capture.getInit()).toBeNull()
  })

  it('crops a lasso to its bounding box plus a margin, inside the display', async () => {
    expect(
      cropFor(
        {
          kind: 'lasso',
          points: [
            { x: 20, y: 30 },
            { x: 120, y: 30 },
            { x: 70, y: 90 }
          ]
        },
        DISPLAY
      )
    ).toEqual({ x: 12, y: 22, width: 116, height: 76 })
    expect(
      cropFor(
        {
          kind: 'lasso',
          points: [
            { x: 2, y: 3 },
            { x: 60, y: 3 },
            { x: 30, y: 40 }
          ]
        },
        DISPLAY
      )
    ).toEqual({ x: 0, y: 0, width: 68, height: 48 })
  })

  it('fits a full-screen capture to 1568 px on its long edge', async () => {
    const { capture, store, ops } = setup()
    await capture.start()
    await capture.commit({ kind: 'full' })
    expect(ops).toEqual(['crop 0,0 3000x2000', 'resize 1568x1045', 'resize 160x107'])
    expect(pending(store)[0]).toMatchObject({ width: 1568, height: 1045 })
  })

  it('treats a stray click as nothing and puts everything back', async () => {
    const { capture, store, overlay, surfaces } = setup()
    await capture.start('rect')
    await capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 3, height: 3 } })
    expect(pending(store)).toEqual([])
    expect(overlay.hidden).toBe(1)
    expect(surfaces.restore).toHaveBeenCalledWith(false)
    expect(capture.isCapturing()).toBe(false)
  })

  it('adds one capture when a commit arrives twice', async () => {
    const { capture, store } = setup()
    await capture.start()
    await Promise.all([capture.commit({ kind: 'full' }), capture.commit({ kind: 'full' })])
    expect(pending(store)).toHaveLength(1)
  })

  it('says so instead of capturing when 4 captures are waiting', async () => {
    const { capture, store, grabs, notes, surfaces } = setup()
    for (let i = 0; i < 4; i++) {
      await capture.start()
      await capture.commit({ kind: 'full' })
    }
    expect(pending(store)).toHaveLength(4)
    await capture.start()
    expect(grabs()).toBe(4)
    expect(notes).toEqual([COPY.full])
    expect(surfaces.hide).toHaveBeenCalledTimes(4)
    expect(capture.isCapturing()).toBe(false)
  })

  it('explains a blank (protected) screen and puts everything back', async () => {
    for (const blank of [{ blank: true }, { grab: null }]) {
      const { capture, overlay, notes, surfaces } = setup(blank)
      await capture.start()
      expect(overlay.shown).toEqual([])
      expect(notes).toEqual([COPY.failed])
      expect(surfaces.restore).toHaveBeenCalledWith(false)
      expect(capture.isCapturing()).toBe(false)
      expect(capture.getInit()).toBeNull()
    }
  })

  it('hides Studio for the grab, then reopens it: on its view after a cancel, on chat after a capture', async () => {
    const { capture, store, studioWin, studioOpen, surfaces } = setup({ studioVisible: true })
    store.update('studio', { view: 'settings' })
    await capture.start()
    expect(studioWin.hide).toHaveBeenCalledOnce()
    await capture.cancel()
    expect(studioOpen).toHaveBeenLastCalledWith('settings')
    await capture.start()
    await capture.commit({ kind: 'full' })
    expect(studioOpen).toHaveBeenLastCalledWith('chat')
    expect(surfaces.hide).not.toHaveBeenCalled()
    expect(surfaces.restore).not.toHaveBeenCalled()
  })

  it('grabs only once the owl is off the screen', async () => {
    const { capture, grabs, surfaces } = setup()
    let release = noop
    surfaces.hide.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const started = capture.start()
    await Promise.resolve()
    expect(grabs()).toBe(0)
    expect(capture.isCapturing()).toBe(true)
    release()
    await started
    expect(grabs()).toBe(1)
  })

  it('never cuts onboarding short', async () => {
    const { capture, store, studioOpen } = setup({ studioVisible: true })
    store.update('studio', { view: 'onboarding' })
    await capture.start()
    await capture.commit({ kind: 'full' })
    expect(studioOpen).toHaveBeenLastCalledWith('onboarding')
  })

  it('ignores commit and cancel when no capture is open', async () => {
    const { capture, store, overlay, surfaces } = setup()
    await capture.commit({ kind: 'full' })
    await capture.cancel()
    expect(pending(store)).toEqual([])
    expect(overlay.hidden).toBe(0)
    expect(surfaces.restore).not.toHaveBeenCalled()
  })

  it('prewarms the overlay window and the grabber', () => {
    const { capture, overlay, warmed } = setup()
    capture.prewarm()
    expect(overlay.prepared).toBe(1)
    expect(warmed()).toBe(1)
  })
})

describe('capture handlers', () => {
  it('has a handler for every capture invoke channel', () => {
    const { capture } = setup()
    const invokes = Object.values(HOOT_API_ROUTES.capture)
      .filter((route) => route.kind === 'invoke')
      .map((route) => route.channel)
      .sort()
    expect(Object.keys(createCaptureHandlers(capture)).sort()).toEqual(invokes)
  })

  it('routes start, getInit, commit and cancel to the service', async () => {
    const { capture, store } = setup()
    const handlers = createCaptureHandlers(capture)
    await handlers['capture:start']('rect')
    expect(await handlers['capture:getInit']()).toMatchObject({ mode: 'rect' })
    await handlers['capture:commit']({ kind: 'full' })
    expect(pending(store)).toHaveLength(1)
    await handlers['capture:start']()
    await handlers['capture:cancel']()
    expect(await handlers['capture:getInit']()).toBeNull()
  })
})
