import {
  DEFAULT_SETTINGS,
  LIVE_SCREEN_NOTE,
  liveScreenNote,
  screenTextBlock,
  type OverlayRestore,
  type Point,
  type Rect
} from '@hoot/core'
import type { CodeWindowInfo } from '@hoot/core/code'
import { describe, expect, it, vi } from 'vitest'
import { createCaptureService, type CaptureDeps, type CaptureImage } from '../../src/main/capture'
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
function setup(
  opts: {
    live?: boolean
    studioVisible?: boolean
    readScreenText?: (rect: Rect) => Promise<string | null>
    owlAnchor?: Point
    codeWindow?: () => CodeWindowInfo | null | Promise<CodeWindowInfo | null>
    appAt?: CaptureDeps['appAt']
    codeNote?: (windowId: string) => Promise<string | null>
  } = {}
) {
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
  const overlay: OverlayHost & {
    hidden: number
    userClicks: Point[]
    restores: OverlayRestore[]
  } = {
    hidden: 0,
    userClicks: [],
    restores: [],
    prepare: noop,
    show: () => void events.push('show'),
    hide: () => {
      overlay.hidden += 1
      events.push('hide')
    },
    setCaptureExcluded: (on) => void events.push(`excluded ${on}`),
    passThrough: () => void events.push('passThrough'),
    userClicked: (at) => void overlay.userClicks.push(at),
    minimize: () => void events.push('minimize'),
    restore: (r) => {
      events.push('restore')
      overlay.restores.push(r)
    }
  }
  const clicked: Point[] = []
  let onClickListener: ((at: Point) => void) | null = null
  let studioVisible = opts.studioVisible ?? false
  const studioOpen = vi.fn<(view?: string) => void>(() => {
    studioVisible = true
  })
  const restore = vi.fn<(added: boolean) => void>()
  const toOwl = vi.fn(() => void events.push('owl shown'))
  const fromOwl = vi.fn(() => void events.push('owl hidden'))
  const newChat = vi.fn(() => {
    events.push('newChat')
    store.update('chat', { session: null, pendingAttachments: [] })
  })
  let ids = 0
  const capture = createCaptureService({
    store,
    windows: {
      get: () => ({
        hide: () => {
          studioVisible = false
        }
      }),
      set: noop,
      all: () => []
    } as unknown as WindowRegistry,
    studio: { open: studioOpen, isVisible: () => studioVisible },
    persistence: {
      saveAttachment: async () => undefined,
      deleteAttachment: async (id: string) => void deleted.push(id)
    } as unknown as Persistence,
    log: silent,
    surfaces: { hide: noop, restore, minimize: toOwl, unminimize: fromOwl },
    grabber,
    overlay,
    live: opts.live ?? true,
    newChat,
    notify: noop,
    wait: async () => undefined,
    newId: () => `a${++ids}`,
    now: () => 42,
    clickScreen: async (at) => {
      events.push('clickScreen')
      clicked.push(at)
      return true
    },
    onScreenClick: (l) => {
      onClickListener = l
      return () => {
        if (onClickListener === l) onClickListener = null
      }
    },
    ...(opts.readScreenText ? { readScreenText: opts.readScreenText } : {}),
    ...(opts.owlAnchor ? { owlAnchor: () => opts.owlAnchor! } : {}),
    ...(opts.codeWindow ? { codeWindow: opts.codeWindow } : {}),
    ...(opts.appAt ? { appAt: opts.appAt } : {}),
    ...(opts.codeNote ? { codeNote: opts.codeNote } : {})
  })
  const pending = (): string[] => store.get('chat').pendingAttachments.map((a) => a.thumbDataUrl)
  return {
    store,
    capture,
    overlay,
    events,
    ops,
    pending,
    studioOpen,
    restore,
    toOwl,
    fromOwl,
    newChat,
    deleted,
    clicked,
    emitScreenClick: (at: Point) => onClickListener?.(at),
    watchingClicks: () => onClickListener !== null
  }
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

  it('attaches the current full screen before each message, with a note that keeps the model on the circled part', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
    t.events.length = 0
    // 0–1000 of the 1500×1000 display.
    const note = liveScreenNote({ x1: 7, y1: 10, x2: 33, y2: 50 })
    expect(await t.capture.attachLiveScreen()).toBe(note)
    expect(note).toContain('x 7–33, y 10–50')
    expect(t.events).toEqual(['excluded true', 'grab 7', 'excluded false'])
    // The circled region first, then the live screen: the model is told the last image is the screen.
    expect(t.pending()).toEqual(['data:image/png;base64,g1', 'data:image/png;base64,g2'])
    // Follow-ups stay on the same part.
    expect(await t.capture.attachLiveScreen()).toBe(note)
  })

  it('the whole screen needs no crop of its own: only the live frame goes, with the plain note', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    expect(t.pending()).toEqual([])
    expect(t.ops).toEqual([])
    expect(await t.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
    expect(t.pending()).toEqual(['data:image/png;base64,g2'])
  })

  it('drawing after the whole screen makes that part the subject again', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    expect(await t.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
    await t.capture.commit({ kind: 'rect', rect: { x: 300, y: 200, width: 300, height: 100 } })
    // A fresh chat with only the new crop (from a new grab), then the live frame.
    expect(t.newChat).toHaveBeenCalledTimes(2)
    expect(t.ops.at(-1)).toBe('crop g3 600,400 600x200')
    expect(await t.capture.attachLiveScreen()).toBe(
      liveScreenNote({ x1: 200, y1: 200, x2: 400, y2: 300 })
    )
    expect(t.pending()).toEqual(['data:image/png;base64,g3', 'data:image/png;base64,g4'])
  })

  it('a shape drawn while the last one is still saving wins (never dropped)', async () => {
    const t = setup()
    await t.capture.start()
    await Promise.all([
      t.capture.commit({ kind: 'full' }),
      t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
    ])
    expect(t.newChat).toHaveBeenCalledTimes(1)
    expect(t.pending()).toHaveLength(1)
    expect(await t.capture.attachLiveScreen()).toBe(
      liveScreenNote({ x1: 7, y1: 10, x2: 33, y2: 50 })
    )
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

  it('sends the text under the shape (screen DIP) with the first message about it only', async () => {
    const reads: Rect[] = []
    const t = setup({
      readScreenText: async (rect) => {
        reads.push(rect)
        return '  const total = price * qty  '
      }
    })
    await t.capture.start()
    await t.capture.commit({ kind: 'rect', rect: { x: 100, y: 50, width: 200, height: 80 } })
    expect(reads).toEqual([{ x: 100, y: 50, width: 200, height: 80 }])

    const region = liveScreenNote({ x1: 67, y1: 50, x2: 200, y2: 130 })
    const first = await t.capture.attachLiveScreen()
    expect(first).toBe(`${region}\n\n${screenTextBlock('  const total = price * qty  ')}`)
    // Later messages carry the live screen only; the first one already holds the text.
    expect(await t.capture.attachLiveScreen()).toBe(region)

    // A new shape reads its own text.
    await t.capture.commit({ kind: 'full' })
    expect(reads.at(-1)).toEqual(DISPLAY)
  })

  it('a failed or empty read leaves only the live screen note', async () => {
    const failing = setup({ readScreenText: () => Promise.reject(new Error('uia down')) })
    await failing.capture.start()
    await failing.capture.commit({ kind: 'full' })
    expect(await failing.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)

    const empty = setup({ readScreenText: async () => '   ' })
    await empty.capture.start()
    await empty.capture.commit({ kind: 'full' })
    expect(await empty.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
  })

  it('closing after "Open in chat" leaves Studio on the chat (no owl, no old view)', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    // The overlay's Open in chat shows Studio first, then closes the overlay.
    t.studioOpen('chat')
    await t.capture.cancel()
    expect(t.restore).not.toHaveBeenCalled()
    expect(t.studioOpen).toHaveBeenCalledTimes(1)

    const fromStudio = setup({ studioVisible: true })
    fromStudio.store.update('studio', { view: 'settings' })
    await fromStudio.capture.start()
    fromStudio.studioOpen('chat')
    await fromStudio.capture.cancel()
    expect(fromStudio.studioOpen.mock.calls).toEqual([['chat']])
  })

  it('clicks a spot on the display and forwards user clicks while the overlay is open', async () => {
    const t = setup()
    expect(await t.capture.click({ x: 100, y: 200 })).toBe(false)
    await t.capture.start()
    expect(t.watchingClicks()).toBe(true)

    t.events.length = 0
    expect(await t.capture.click({ x: 300, y: 400 })).toBe(true)
    expect(t.clicked).toEqual([{ x: 300, y: 400 }])
    // The overlay lets clicks pass through before moving the pointer and clicking.
    expect(t.events).toEqual(['passThrough', 'clickScreen'])

    t.emitScreenClick({ x: 310, y: 410 })
    // Outside the display: ignored.
    t.emitScreenClick({ x: 9000, y: 10 })
    expect(t.overlay.userClicks).toEqual([{ x: 310, y: 410 }])

    await t.capture.cancel()
    expect(t.watchingClicks()).toBe(false)
  })

  it('tells the overlay where the owl is on its display (for minimizing into it)', async () => {
    const here = setup({ owlAnchor: { x: 1460, y: 960 } })
    await here.capture.start()
    expect(here.capture.getInit()?.owlAt).toEqual({ x: 1460, y: 960 })

    const elsewhere = setup({ owlAnchor: { x: 3000, y: 960 } })
    await elsewhere.capture.start()
    expect(elsewhere.capture.getInit()?.owlAt).toBeNull()
  })

  it('minimizes into the owl and comes back out with the chat as it was', async () => {
    const t = setup({ owlAnchor: { x: 1460, y: 960 } })
    await t.capture.start()
    await t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
    t.events.length = 0

    await t.capture.minimize()
    expect(t.capture.isMinimized()).toBe(true)
    expect(t.events).toEqual(['minimize', 'owl shown'])
    // Still capturing; nothing was closed or dropped.
    expect(t.capture.isCapturing()).toBe(true)
    expect(t.overlay.hidden).toBe(0)
    expect(t.pending()).toHaveLength(1)
    // From the owl's card, a message is a plain one; clicks are just the user working.
    expect(await t.capture.attachLiveScreen()).toBeNull()
    t.emitScreenClick({ x: 30, y: 30 })
    expect(t.overlay.userClicks).toEqual([])

    expect(t.capture.restore()).toBe(true)
    expect(t.capture.isMinimized()).toBe(false)
    expect(t.events.slice(2)).toEqual(['owl hidden', 'restore'])
    expect(t.overlay.restores).toEqual([{ owlAt: { x: 1460, y: 960 }, draw: false }])
    // Nothing minimized: the caller (the owl's chat button) does what it meant to.
    expect(t.capture.restore()).toBe(false)
    expect(await t.capture.attachLiveScreen()).toBe(
      liveScreenNote({ x1: 7, y1: 10, x2: 33, y2: 50 })
    )
  })

  it('circling again while minimized brings the overlay back, ready to draw (no new grab)', async () => {
    const t = setup()
    await t.capture.start()
    await t.capture.commit({ kind: 'full' })
    await t.capture.minimize()
    t.events.length = 0
    await t.capture.start('lasso')
    expect(t.events).toEqual(['owl hidden', 'restore'])
    expect(t.overlay.restores).toEqual([{ owlAt: null, draw: true }])
  })

  it('closing a minimized overlay ends it; minimize does nothing when closed', async () => {
    const t = setup()
    await t.capture.minimize()
    expect(t.capture.isMinimized()).toBe(false)
    await t.capture.start()
    await t.capture.minimize()
    await t.capture.cancel()
    expect(t.capture.isMinimized()).toBe(false)
    expect(t.capture.isCapturing()).toBe(false)
    expect(t.capture.restore()).toBe(false)
  })

  describe('with VS Code in front (the code link)', () => {
    const vscode: CodeWindowInfo = { id: 'win-1', name: 'hoot' }

    it('pins the window when it opens and sends its code instead of grabbing the screen', async () => {
      const asked: string[] = []
      const windows = vi.fn(() => vscode)
      const t = setup({
        codeWindow: windows,
        codeNote: async (id) => {
          asked.push(id)
          return `[VS Code: code #${asked.length}]`
        },
        readScreenText: async () => 'for (let i = 0; i <= n; i++)'
      })
      await t.capture.start()
      expect(windows).toHaveBeenCalledTimes(1)
      expect(t.capture.getInit()?.code).toEqual({ name: 'hoot' })
      await t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
      t.events.length = 0

      // The circled crop stays; the message gets the code (and the text under the shape), no frame.
      expect(await t.capture.attachLiveScreen()).toBe(
        `[VS Code: code #1]\n\n${screenTextBlock('for (let i = 0; i <= n; i++)')}`
      )
      expect(await t.capture.attachLiveScreen()).toBe('[VS Code: code #2]')
      expect(t.events.filter((e) => e.startsWith('grab'))).toEqual([])
      expect(t.pending()).toEqual(['data:image/png;base64,g1'])
      expect(asked).toEqual(['win-1', 'win-1'])
    })

    it('falls back to the screen when VS Code doesn’t answer', async () => {
      const t = setup({ codeWindow: () => vscode, codeNote: async () => null })
      await t.capture.start()
      await t.capture.commit({ kind: 'full' })
      expect(await t.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
      expect(t.pending()).toEqual(['data:image/png;base64,g2'])
    })

    it('grabs the screen as before when no VS Code window was in front', async () => {
      const codeNote = vi.fn(async () => 'never')
      const t = setup({ codeWindow: () => null, codeNote })
      await t.capture.start()
      expect(t.capture.getInit()?.code).toBeNull()
      await t.capture.commit({ kind: 'full' })
      expect(await t.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
      expect(codeNote).not.toHaveBeenCalled()
    })

    // The overlay was opened over the browser; the user then went to VS Code
    // and pressed Full screen in the same overlay: that shape is about the code.
    it('reads the code for a shape drawn over VS Code, whatever was in front at open', async () => {
      const regions: Rect[] = []
      const readScreenText = vi.fn(async () => 'the whole screen')
      const t = setup({
        codeWindow: () => null,
        appAt: async (region) => {
          regions.push(region)
          return { code: vscode, page: null }
        },
        codeNote: async (id) => `[VS Code: ${id}]`,
        readScreenText
      })
      await t.capture.start()
      expect(t.capture.getInit()?.code).toBeNull()
      await t.capture.commit({ kind: 'full' })
      expect(regions).toEqual([DISPLAY])
      expect(t.capture.getInit()?.code).toEqual({ name: 'hoot' })
      // The code note carries the file; the whole screen's text would only repeat it.
      expect(await t.capture.attachLiveScreen()).toBe('[VS Code: win-1]')
      expect(readScreenText).not.toHaveBeenCalled()
      expect(t.pending()).toEqual([])
    })

    it('goes back to the screen for a shape drawn over another app', async () => {
      const codeNote = vi.fn(async () => 'never')
      const t = setup({
        codeWindow: () => vscode,
        appAt: async () => ({ code: null, page: null }),
        codeNote
      })
      await t.capture.start()
      expect(t.capture.getInit()?.code).toEqual({ name: 'hoot' })
      await t.capture.commit({ kind: 'rect', rect: { x: 10, y: 10, width: 40, height: 40 } })
      expect(t.capture.getInit()?.code).toBeNull()
      expect(await t.capture.attachLiveScreen()).toBe(
        liveScreenNote({ x1: 7, y1: 10, x2: 33, y2: 50 })
      )
      expect(codeNote).not.toHaveBeenCalled()
    })

    it('keeps what it read at open when Windows can’t say which app is under the shape', async () => {
      const t = setup({
        codeWindow: () => vscode,
        appAt: async () => undefined,
        codeNote: async () => '[VS Code: kept]'
      })
      await t.capture.start()
      await t.capture.commit({ kind: 'full' })
      expect(await t.capture.attachLiveScreen()).toBe('[VS Code: kept]')
    })

    it('coming back out of the owl to draw reads the app in front now', async () => {
      let inFront: CodeWindowInfo | null = null
      const t = setup({
        codeWindow: async () => inFront,
        codeNote: async () => '[VS Code: now]'
      })
      await t.capture.start()
      await t.capture.commit({ kind: 'full' })
      expect(await t.capture.attachLiveScreen()).toBe(LIVE_SCREEN_NOTE)
      await t.capture.minimize()
      inFront = vscode
      await t.capture.start('lasso')
      await t.capture.commit({ kind: 'full' })
      expect(t.capture.getInit()?.code).toEqual({ name: 'hoot' })
      expect(await t.capture.attachLiveScreen()).toBe('[VS Code: now]')
    })
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
