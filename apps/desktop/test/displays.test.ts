import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rect, WindowKind } from '@hoot/core'
import type { BrowserWindow } from 'electron'
import { centreInWorkArea } from '../src/main/windows/bounds'
import { watchDisplays, type DisplayScreen } from '../src/main/windows/displays'
import type { WindowRegistry } from '../src/main/windows/base'
import { studioMaterial } from '../src/main/windows/studio'
import { watchPower } from '../src/main/powerWatch'

type Ev = 'display-added' | 'display-removed' | 'display-metrics-changed'

function makeScreen(workAreas: Rect[]): DisplayScreen & { emit(e: Ev): void } {
  const listeners = new Map<string, (() => void)[]>()
  return {
    on: (e, cb) => {
      const l = listeners.get(e) ?? []
      l.push(cb)
      listeners.set(e, l)
    },
    removeListener: (e, cb) => {
      listeners.set(
        e,
        (listeners.get(e) ?? []).filter((l) => l !== cb)
      )
    },
    emit: (e) => listeners.get(e)?.forEach((cb) => cb()),
    getAllDisplays: () => workAreas.map((workArea) => ({ workArea })),
    getPrimaryDisplay: () => ({ workArea: workAreas[0]! })
  }
}

function makeWin(bounds: Rect): {
  win: BrowserWindow
  setVisible(v: boolean): void
  bounds: () => Rect
} {
  const w = {
    visible: true,
    b: bounds,
    isDestroyed: () => false,
    isVisible: () => w.visible,
    getBounds: () => ({ ...w.b }),
    setBounds: (nb: Rect) => {
      w.b = { ...nb }
    }
  }
  return {
    win: w as unknown as BrowserWindow,
    setVisible: (v: boolean) => {
      w.visible = v
    },
    bounds: () => w.b
  }
}

function makeRegistry(map: Map<WindowKind, BrowserWindow>): WindowRegistry {
  return {
    get: (k) => map.get(k),
    set: (k, w) => void map.set(k, w),
    all: () => [...map.values()]
  }
}

const wa: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

describe('watchDisplays', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces bursts into one check that relayouts the buddy', () => {
    const screen = makeScreen([wa])
    const relayoutBuddy = vi.fn()
    watchDisplays({ screen, windows: makeRegistry(new Map()), relayoutBuddy })
    screen.emit('display-removed')
    screen.emit('display-metrics-changed')
    vi.advanceTimersByTime(249)
    expect(relayoutBuddy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(relayoutBuddy).toHaveBeenCalledTimes(1)
  })

  it('re-centres a visible window stranded off every work area', () => {
    const screen = makeScreen([wa])
    const stranded = makeWin({ x: 5000, y: 5000, width: 800, height: 600 })
    const map = new Map<WindowKind, BrowserWindow>([['studio', stranded.win]])
    watchDisplays({ screen, windows: makeRegistry(map), relayoutBuddy: vi.fn() })
    screen.emit('display-removed')
    vi.advanceTimersByTime(250)
    expect(stranded.bounds()).toEqual(centreInWorkArea(wa, { width: 800, height: 600 }))
  })

  it('leaves a visible window still intersecting a work area alone', () => {
    const screen = makeScreen([wa])
    const home = makeWin({ x: 100, y: 100, width: 800, height: 600 })
    const map = new Map<WindowKind, BrowserWindow>([['reader', home.win]])
    watchDisplays({ screen, windows: makeRegistry(map), relayoutBuddy: vi.fn() })
    screen.emit('display-removed')
    vi.advanceTimersByTime(250)
    expect(home.bounds()).toEqual({ x: 100, y: 100, width: 800, height: 600 })
  })

  it('ignores hidden windows even when they are off-screen', () => {
    const screen = makeScreen([wa])
    const hidden = makeWin({ x: 5000, y: 5000, width: 800, height: 600 })
    hidden.setVisible(false)
    const map = new Map<WindowKind, BrowserWindow>([['studio', hidden.win]])
    watchDisplays({ screen, windows: makeRegistry(map), relayoutBuddy: vi.fn() })
    screen.emit('display-removed')
    vi.advanceTimersByTime(250)
    expect(hidden.bounds().x).toBe(5000)
  })

  it('unsubscribing removes the listeners and drops a pending check', () => {
    const screen = makeScreen([wa])
    const relayoutBuddy = vi.fn()
    const unwatch = watchDisplays({
      screen,
      windows: makeRegistry(new Map()),
      relayoutBuddy
    })
    unwatch()
    screen.emit('display-added')
    vi.advanceTimersByTime(500)
    expect(relayoutBuddy).not.toHaveBeenCalled()
    screen.emit('display-removed')
    vi.advanceTimersByTime(500)
    expect(relayoutBuddy).not.toHaveBeenCalled()
  })
})

describe('watchPower', () => {
  it('repaints + relayouts the buddy and re-registers hotkeys on wake', () => {
    const calls = { resume: 0, apply: 0 }
    const listeners: (() => void)[] = []
    const powerMonitor = {
      on: (_e: 'resume' | 'unlock-screen', cb: () => void) => {
        listeners.push(cb)
      },
      removeListener: (_e: 'resume' | 'unlock-screen', cb: () => void) => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    }
    const unwatch = watchPower({
      powerMonitor,
      buddy: { resume: () => calls.resume++ },
      hotkeys: { apply: () => calls.apply++ }
    })
    expect(listeners).toHaveLength(2)
    listeners.forEach((cb) => cb())
    expect(calls).toEqual({ resume: 2, apply: 2 })
    unwatch()
    listeners.forEach((cb) => cb())
    expect(calls).toEqual({ resume: 2, apply: 2 })
  })
})

describe('studioMaterial', () => {
  it('is mica on Windows 11 without high contrast', () => {
    expect(studioMaterial({ windowsBuild: 22000, highContrast: false })).toBe('mica')
    expect(studioMaterial({ windowsBuild: 26100, highContrast: false })).toBe('mica')
  })

  it('falls back on Windows 10 (< 22000) or a non-Windows build number', () => {
    expect(studioMaterial({ windowsBuild: 19045, highContrast: false })).toBe('none')
    expect(studioMaterial({ windowsBuild: 0, highContrast: false })).toBe('none')
  })

  it('falls back under high contrast regardless of build', () => {
    expect(studioMaterial({ windowsBuild: 26100, highContrast: true })).toBe('none')
  })
})
