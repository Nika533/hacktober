import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, HOOT_API_ROUTES, type Rect, type StateSlices } from '@hoot/core'
import type { BuddyDeps, BuddyWindowLike } from '../src/main/buddy/window'
import { createBuddyWindow } from '../src/main/buddy/window'
import type { Logger } from '../src/main/log'
import { createStore, initialSlices } from '../src/main/store/store'

const TRANSITION = HOOT_API_ROUTES.buddy.onTransition.channel
const CURSOR = HOOT_API_ROUTES.buddy.onCursor.channel

const WA: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

const system: StateSlices['system'] = {
  platform: 'win32',
  version: '0.0.0',
  packaged: false,
  accentColor: '#CA5010',
  darkMode: false,
  highContrast: false
}

const log: Logger = { info: () => {}, warn: () => {}, error: () => {} }

function makeScreen(): {
  cursor: { x: number; y: number }
  workArea: Rect
  getCursorScreenPoint(): { x: number; y: number }
  getDisplayNearestPoint(): { workArea: Rect }
  getPrimaryDisplay(): { workArea: Rect }
} {
  const s = {
    cursor: { x: 960, y: 500 },
    workArea: WA,
    getCursorScreenPoint: () => ({ ...s.cursor }),
    getDisplayNearestPoint: () => ({ workArea: s.workArea }),
    getPrimaryDisplay: () => ({ workArea: s.workArea })
  }
  return s
}

interface Sent {
  channel: string
  payload: unknown
}

type FakeWin = BuddyWindowLike & { emit(e: 'focus' | 'blur' | 'closed'): void }

interface FakeWinHandle {
  win: FakeWin
  sent: Sent[]
  ignores: { ignore: boolean; forward?: boolean }[]
  positions: { x: number; y: number }[]
  calls: { show: number; hide: number; focus: number; invalidate: number }
  setBounds(b: Rect): void
  setFocused(v: boolean): void
}

function makeFakeWin(): FakeWinHandle {
  const listeners: Partial<Record<'focus' | 'blur' | 'closed', (() => void)[]>> = {}
  const sent: Sent[] = []
  const ignores: { ignore: boolean; forward?: boolean }[] = []
  const positions: { x: number; y: number }[] = []
  const calls = { show: 0, hide: 0, focus: 0, invalidate: 0 }
  let bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  let visible = false
  let focused = false
  const win: FakeWin = {
    show: () => {
      visible = true
      calls.show++
    },
    hide: () => {
      visible = false
      calls.hide++
    },
    focus: () => {
      calls.focus++
    },
    isVisible: () => visible,
    isFocused: () => focused,
    isDestroyed: () => false,
    setIgnoreMouseEvents: (ignore, opts) => {
      ignores.push({ ignore, forward: opts?.forward })
    },
    setPosition: (x, y) => {
      positions.push({ x, y })
      bounds = { ...bounds, x, y }
    },
    setBounds: (b) => {
      bounds = { ...b }
    },
    getBounds: () => ({ ...bounds }),
    on: (e, cb) => {
      ;(listeners[e] ??= []).push(cb)
    },
    emit: (e) => listeners[e]?.forEach((cb) => cb()),
    webContents: {
      send: (ch, p) => sent.push({ channel: ch, payload: p }),
      invalidate: () => {
        calls.invalidate++
      }
    }
  }
  return {
    win,
    sent,
    ignores,
    positions,
    calls,
    setBounds: (b: Rect) => {
      bounds = { ...b }
    },
    setFocused: (v: boolean) => {
      focused = v
    }
  }
}

function setup(opts: { collapseMs?: number } = {}): {
  buddy: ReturnType<typeof createBuddyWindow>
  store: ReturnType<typeof createStore>
  screen: ReturnType<typeof makeScreen>
  fake: FakeWinHandle
} {
  const store = createStore(
    initialSlices({
      settings: {
        ...DEFAULT_SETTINGS,
        onboardingDone: true,
        ...(opts.collapseMs !== undefined ? { collapseToDotAfterMs: opts.collapseMs } : {})
      },
      hasApiKey: false,
      keyStorage: 'os-encrypted',
      system
    })
  )
  const screen = makeScreen()
  const fake = makeFakeWin()
  const deps: BuddyDeps = {
    store,
    windows: { get: () => undefined, set: () => {}, all: () => [] },
    log,
    screen,
    createWindow: (bounds) => {
      fake.setBounds(bounds)
      return fake.win
    }
  }
  const buddy = createBuddyWindow(deps)
  return { buddy, store, screen, fake }
}

const transitions = (sent: Sent[]): unknown[] =>
  sent.filter((s) => s.channel === TRANSITION).map((s) => s.payload)

describe('buddy window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('summon shows the fixed card canvas, sends the transition and greets', () => {
    const { buddy, store, fake } = setup()
    buddy.summon()
    const buddySlice = store.get('buddy')
    expect(buddySlice.mode).toBe('pill')
    expect(buddySlice.greeting).not.toBeNull()
    // 420×620 card canvas padded 16 DIP on every side (#82 shadow fix).
    expect(buddySlice.layout?.bounds).toMatchObject({ width: 452, height: 652 })
    expect(fake.calls.show).toBe(1)
    expect(fake.calls.invalidate).toBe(1)
    expect(transitions(fake.sent)).toEqual([{ id: 1, from: 'hidden', to: 'pill' }])
    // window position tracks the anchor (default bottom-right inset 40)
    const b = fake.win.getBounds()
    expect(b.x + buddySlice.layout!.owl.x).toBeCloseTo(1880, 0)
    expect(b.y + buddySlice.layout!.owl.y).toBeCloseTo(1000, 0)
  })

  it('transitionDone on a hidden request hides the window and clears layout', () => {
    const { buddy, store, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    buddy.request('hidden')
    expect(store.get('buddy').mode).toBe('hidden')
    expect(store.get('buddy').layout).toBeNull()
    expect(fake.win.isVisible()).toBe(true) // waits for the renderer to finish
    buddy.transitionDone(2)
    expect(fake.win.isVisible()).toBe(false)
  })

  it('the 450 ms fallback hides the window without an ack', () => {
    const { buddy, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    buddy.request('hidden')
    vi.advanceTimersByTime(450)
    expect(fake.win.isVisible()).toBe(false)
    expect(fake.calls.hide).toBe(1)
  })

  it('a stale transitionDone does not hide a superseding transition', () => {
    const { buddy, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    buddy.request('card') // id 2 pending
    buddy.request('hidden') // id 3 supersedes
    buddy.transitionDone(2) // stale
    expect(fake.win.isVisible()).toBe(true)
    buddy.transitionDone(3)
    expect(fake.win.isVisible()).toBe(false)
  })

  it('collapses pill → dot after collapseToDotAfterMs and stops there', () => {
    const { buddy, store } = setup({ collapseMs: 1500 })
    buddy.summon()
    buddy.transitionDone(1)
    vi.advanceTimersByTime(1499)
    expect(store.get('buddy').mode).toBe('pill')
    vi.advanceTimersByTime(1)
    expect(store.get('buddy').mode).toBe('dot')
    // no further timer: dot stays dot
    vi.advanceTimersByTime(10_000)
    expect(store.get('buddy').mode).toBe('dot')
  })

  it('does not collapse while hovered, focused or streaming', async () => {
    const { buddy, store } = setup({ collapseMs: 1000 })
    buddy.summon()
    buddy.transitionDone(1)
    buddy.setIgnoreMouse(false) // hover
    vi.advanceTimersByTime(2000)
    expect(store.get('buddy').mode).toBe('pill')
    buddy.setIgnoreMouse(true)
    vi.advanceTimersByTime(1000)
    expect(store.get('buddy').mode).toBe('dot')

    // focused
    const run2 = setup({ collapseMs: 1000 })
    run2.buddy.summon()
    run2.buddy.transitionDone(1)
    run2.fake.win.emit('focus')
    run2.fake.setFocused(true)
    vi.advanceTimersByTime(2000)
    expect(run2.store.get('buddy').mode).toBe('pill')
    run2.fake.setFocused(false)
    run2.fake.win.emit('blur')
    vi.advanceTimersByTime(1000)
    expect(run2.store.get('buddy').mode).toBe('dot')

    // streaming
    const run3 = setup({ collapseMs: 1000 })
    run3.buddy.summon()
    run3.buddy.transitionDone(1)
    run3.store.update('chat', { stream: { sessionId: 's', messageId: 'm' } })
    await Promise.resolve() // store.onChange flushes in a microtask
    vi.advanceTimersByTime(2000)
    expect(run3.store.get('buddy').mode).toBe('pill')
    run3.store.update('chat', { stream: null })
    await Promise.resolve() // watcher re-arms the collapse timer
    vi.advanceTimersByTime(1000)
    expect(run3.store.get('buddy').mode).toBe('dot')
  })

  it('re-arms the collapse timer when the cursor leaves the regions', () => {
    const { buddy, store, screen, fake } = setup({ collapseMs: 1000 })
    buddy.summon()
    buddy.transitionDone(1)
    const b = fake.win.getBounds()
    // Cursor inside the owl's region: the next poll flips inside → the timer
    // is cancelled and stays cancelled while the cursor hovers.
    buddy.setHitRegions([{ x: 100, y: 100, width: 100, height: 100 }])
    screen.cursor = { x: b.x + 150, y: b.y + 150 }
    vi.advanceTimersByTime(50)
    vi.advanceTimersByTime(5000)
    expect(store.get('buddy').mode).toBe('pill')
    // Cursor leaves: the tick flips inside → re-arms collapseToDotAfterMs.
    screen.cursor = { x: 0, y: 0 }
    vi.advanceTimersByTime(50)
    vi.advanceTimersByTime(999)
    expect(store.get('buddy').mode).toBe('pill')
    vi.advanceTimersByTime(1)
    expect(store.get('buddy').mode).toBe('dot')
  })

  it('cancels the collapse timer when the hover hint turns on mid-count', () => {
    const { buddy, store } = setup({ collapseMs: 1000 })
    buddy.summon()
    buddy.transitionDone(1)
    vi.advanceTimersByTime(500)
    buddy.setIgnoreMouse(false) // hover hint on
    vi.advanceTimersByTime(5000)
    expect(store.get('buddy').mode).toBe('pill')
    buddy.setIgnoreMouse(true)
    vi.advanceTimersByTime(1000)
    expect(store.get('buddy').mode).toBe('dot')
  })

  it('polls hit regions at 20 Hz and toggles click-through only on change', () => {
    const { buddy, screen, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    const b = fake.win.getBounds()
    buddy.setHitRegions([{ x: 100, y: 100, width: 50, height: 50 }])
    screen.cursor = { x: b.x + 120, y: b.y + 120 }
    vi.advanceTimersByTime(50)
    expect(fake.ignores.at(-1)).toEqual({ ignore: false, forward: true })
    const count = fake.ignores.length
    vi.advanceTimersByTime(200) // still inside → no new calls
    expect(fake.ignores.length).toBe(count)
    screen.cursor = { x: 0, y: 0 }
    vi.advanceTimersByTime(50)
    expect(fake.ignores.at(-1)).toEqual({ ignore: true, forward: true })
  })

  it('emits buddy:cursor relative to the owl while tracking dot/pill', () => {
    const { buddy, store, screen, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    const b = fake.win.getBounds()
    screen.cursor = { x: b.x + 200, y: b.y + 200 }
    vi.advanceTimersByTime(50)
    const last = fake.sent.filter((s) => s.channel === CURSOR).at(-1)
    const owl = store.get('buddy').layout!.owl
    expect(last?.payload).toEqual({ x: 200 - owl.x, y: 200 - owl.y })
    buddy.setCursorTracking(false)
    fake.sent.length = 0
    vi.advanceTimersByTime(100)
    expect(fake.sent.filter((s) => s.channel === CURSOR)).toEqual([])
    // …but hit testing keeps running: a region under the cursor still
    // toggles click-through off.
    buddy.setHitRegions([{ x: 150, y: 150, width: 100, height: 100 }])
    vi.advanceTimersByTime(50)
    expect(fake.ignores.at(-1)).toEqual({ ignore: false, forward: true })
  })

  it('drag follows the cursor 1:1 and settles the anchor with snap+persist', () => {
    const { buddy, store, screen, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    const b = fake.win.getBounds()
    const owl = store.get('buddy').layout!.owl
    const anchor0 = { x: b.x + owl.x, y: b.y + owl.y }
    screen.cursor = { x: anchor0.x + 5, y: anchor0.y + 5 }
    buddy.dragStart()
    screen.cursor = { x: 500, y: 500 }
    buddy.dragMove()
    const last = fake.positions.at(-1)!
    // anchor follows the cursor minus the grab offset
    expect(last.x).toBe(Math.round(495 - owl.x))
    expect(last.y).toBe(Math.round(495 - owl.y))
    buddy.dragEnd({ vx: 0, vy: 0 })
    vi.advanceTimersByTime(1000) // spring settles (0.9 s cap)
    const settings = store.get('settings').settings
    expect(settings.pillAnchor).toEqual({ x: 495, y: 495 })
    const l = store.get('buddy').layout!
    expect(l.bounds.x + l.owl.x).toBeCloseTo(495, 0)
    expect(l.bounds.y + l.owl.y).toBeCloseTo(495, 0)
  })

  it('dragEnd snaps a fling to the edge inset', () => {
    const { buddy, store, screen, fake } = setup()
    buddy.summon()
    buddy.transitionDone(1)
    const b = fake.win.getBounds()
    const owl = store.get('buddy').layout!.owl
    screen.cursor = { x: b.x + owl.x, y: b.y + owl.y }
    buddy.dragStart()
    screen.cursor = { x: 10, y: 500 }
    buddy.dragMove()
    buddy.dragEnd({ vx: -2000, vy: 0 })
    vi.advanceTimersByTime(1000)
    expect(store.get('settings').settings.pillAnchor).toEqual({ x: 40, y: 500 })
  })

  it('dismissGreeting clears the greeting', () => {
    const { buddy, store } = setup()
    buddy.summon()
    expect(store.get('buddy').greeting).not.toBeNull()
    buddy.dismissGreeting()
    expect(store.get('buddy').greeting).toBeNull()
  })

  it('setAnchor relayouts the fixed window around the new point', () => {
    const { buddy, store } = setup()
    buddy.summon()
    buddy.setAnchor({ x: 60, y: 60 })
    const l = store.get('buddy').layout!
    expect(l.openX).toBe('right')
    expect(l.openY).toBe('down')
    expect(l.bounds.x + l.owl.x).toBeCloseTo(60, 0)
    expect(l.bounds.y + l.owl.y).toBeCloseTo(60, 0)
    expect(store.get('settings').settings.pillAnchor).toEqual({ x: 60, y: 60 })
  })
})
