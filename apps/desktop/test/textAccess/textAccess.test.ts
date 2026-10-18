import type { Point, Rect } from '@hoot/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextAccess, TEXT_IN_RECT_MAX, type ScreenSeam } from '../../src/main/textAccess'
import type { Helper, Reply } from '../../src/main/textAccess/helper'
import { cleanText, joinItems, pixelRect } from '../../src/main/textAccess/text'

vi.mock('electron', () => ({}))

/** Text access on top of a fake helper: selection (UIA, then clipboard), textInRect, clicks. */

type Handler = (args: Record<string, unknown>) => Reply | null | Promise<Reply | null>

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/** A 150% display: physical = DIP × 1.5. */
const scale = 1.5
const screen: ScreenSeam = {
  rectToDip: (r: Rect) => ({
    x: r.x / scale,
    y: r.y / scale,
    width: r.width / scale,
    height: r.height / scale
  }),
  rectToScreen: (r: Rect) => ({
    x: r.x * scale,
    y: r.y * scale,
    width: r.width * scale,
    height: r.height * scale
  }),
  pointToDip: (p: Point) => ({ x: p.x / scale, y: p.y / scale }),
  pointToScreen: (p: Point) => ({ x: p.x * scale, y: p.y * scale })
}

const APP = { process: 'notepad', title: 'notes.txt - Notepad', pid: 42, terminal: false }

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function setup(handlers: Record<string, Handler> = {}, opts: { enabled?: boolean } = {}) {
  const calls: Array<Record<string, unknown> & { cmd: string }> = []
  const listeners = new Set<(m: Reply) => void>()
  let running = false
  let clock = 1000
  const helper: Helper = {
    call: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
      calls.push({ cmd, ...args })
      running = true
      const h = handlers[cmd]
      return h ? await h(args) : null
    }),
    listen: (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    running: () => running,
    start: vi.fn(() => {
      running = true
    }),
    dispose: vi.fn()
  }
  const ta = createTextAccess({
    log: silent,
    enabled: opts.enabled ?? true,
    helper,
    screen,
    selfPid: 4242,
    sleep: async () => undefined,
    now: () => clock
  })
  return {
    ta,
    helper,
    calls,
    cmds: () => calls.map((c) => c.cmd),
    emit: (m: Reply) => listeners.forEach((l) => l(m)),
    tick: (ms: number) => void (clock += ms)
  }
}

/** Clipboard commands that behave like a real clipboard: the copy lands after `lag` polls. */
function clipboardHandlers(copied: string, lag = 2): Record<string, Handler> {
  let polls = 0
  return {
    clipSave: () => ({ token: 7 }),
    clipClear: () => ({ done: true }),
    copy: () => ({ sent: true }),
    clipText: () => ({ text: ++polls > lag ? copied : '' }),
    clipRestore: () => ({ done: true })
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createTextAccess: disabled', () => {
  it('resolves null everywhere and never touches the helper', async () => {
    const t = setup({}, { enabled: false })
    t.ta.prewarm()
    expect(await t.ta.selection()).toBeNull()
    expect(await t.ta.textInRect({ x: 0, y: 0, width: 10, height: 10 })).toBeNull()
    expect(await t.ta.foreground()).toBeNull()
    expect(await t.ta.click({ x: 1, y: 1 })).toBe(false)
    const off = t.ta.onClick(() => undefined)
    off()
    t.ta.dispose()
    expect(t.helper.call).not.toHaveBeenCalled()
    expect(t.helper.start).not.toHaveBeenCalled()
  })
})

describe('createTextAccess: selection', () => {
  it('UI Automation text comes back trimmed, with its paragraph and rects in DIP', async () => {
    const t = setup({
      selection: () => ({
        ...APP,
        text: '  hello world \r\n',
        paragraph: 'Say hello world now.\r\n',
        rects: [
          { x: 150, y: 300, w: 300, h: 30 },
          { x: 10, y: 10, w: 0, h: 5 }
        ]
      })
    })
    expect(await t.ta.selection()).toEqual({
      text: 'hello world',
      paragraph: 'Say hello world now.',
      rects: [{ x: 100, y: 200, width: 200, height: 20 }],
      app: { process: 'notepad', title: 'notes.txt - Notepad' },
      source: 'uia'
    })
    expect(t.cmds()).toEqual(['selection'])
  })

  it('drops a "paragraph" that does not contain the selection', async () => {
    const t = setup({
      selection: () => ({ ...APP, text: 'beta', paragraph: 'alpha', rects: [] })
    })
    expect((await t.ta.selection())?.paragraph).toBe('')
  })

  it('falls back to Ctrl+C: snapshot, clear, copy, poll, then restore', async () => {
    const t = setup({
      selection: () => ({ ...APP, text: '', paragraph: '', rects: [] }),
      ...clipboardHandlers(' copied text\r\n')
    })
    expect(await t.ta.selection()).toEqual({
      text: 'copied text',
      paragraph: '',
      rects: [],
      app: { process: 'notepad', title: 'notes.txt - Notepad' },
      source: 'clipboard'
    })
    expect(t.cmds()).toEqual([
      'selection',
      'clipSave',
      'clipClear',
      'copy',
      'clipText',
      'clipText',
      'clipText',
      'clipRestore'
    ])
    expect(t.calls.at(-1)).toEqual({ cmd: 'clipRestore', token: 7 })
  })

  it('restores the clipboard when nothing gets copied (~600 ms of polls)', async () => {
    const t = setup({
      selection: () => ({ ...APP, text: '', rects: [] }),
      ...clipboardHandlers('never', Infinity)
    })
    expect(await t.ta.selection()).toBeNull()
    expect(t.cmds().filter((c) => c === 'clipText')).toHaveLength(24)
    expect(t.cmds().at(-1)).toBe('clipRestore')
  })

  it('restores the clipboard when the copy keystroke fails', async () => {
    const t = setup({
      selection: () => ({ ...APP, text: '', rects: [] }),
      ...clipboardHandlers('x'),
      copy: () => null
    })
    expect(await t.ta.selection()).toBeNull()
    expect(t.cmds()).toEqual(['selection', 'clipSave', 'clipClear', 'copy', 'clipRestore'])
  })

  it('restores the clipboard even when a poll throws', async () => {
    const t = setup({
      selection: () => ({ ...APP, text: '', rects: [] }),
      ...clipboardHandlers('x'),
      clipText: () => {
        throw new Error('pipe broke')
      }
    })
    expect(await t.ta.selection()).toBeNull()
    expect(t.cmds().at(-1)).toBe('clipRestore')
  })

  it('never touches a clipboard it could not snapshot', async () => {
    for (const saved of [null, { token: -1 }]) {
      const t = setup({
        selection: () => ({ ...APP, text: '', rects: [] }),
        ...clipboardHandlers('x'),
        clipSave: () => saved
      })
      expect(await t.ta.selection()).toBeNull()
      expect(t.cmds()).toEqual(['selection', 'clipSave'])
    }
  })

  it('never sends Ctrl+C into a terminal', async () => {
    const t = setup({
      selection: () => ({
        ...APP,
        process: 'WindowsTerminal',
        terminal: true,
        text: '',
        rects: []
      }),
      ...clipboardHandlers('x')
    })
    expect(await t.ta.selection()).toBeNull()
    expect(t.cmds()).toEqual(['selection'])
  })

  it('when UI Automation fails, asks for the foreground app and still tries the clipboard', async () => {
    const t = setup({
      selection: () => null,
      foreground: () => APP,
      ...clipboardHandlers('copied', 0)
    })
    expect(await t.ta.selection()).toMatchObject({
      text: 'copied',
      source: 'clipboard',
      app: { process: 'notepad' }
    })
    expect(t.cmds().slice(0, 3)).toEqual(['selection', 'foreground', 'clipSave'])
  })

  it('a second selection() while one runs gets the same promise', async () => {
    let release: (r: Reply) => void = () => undefined
    const t = setup({ selection: () => new Promise<Reply>((r) => (release = r)) })
    const a = t.ta.selection()
    const b = t.ta.selection()
    expect(b).toBe(a)
    release({ ...APP, text: 'once', rects: [] })
    expect(await a).toMatchObject({ text: 'once' })
    expect(t.cmds()).toEqual(['selection'])
    void t.ta.selection()
    expect(t.cmds()).toEqual(['selection', 'selection'])
  })

  it('caps very long selections', async () => {
    const t = setup({ selection: () => ({ ...APP, text: 'a'.repeat(50_000), rects: [] }) })
    expect((await t.ta.selection())?.text).toHaveLength(20_000)
  })
})

describe('createTextAccess: textInRect and foreground', () => {
  it('sends the rect in physical px with Hoot excluded, and joins what comes back', async () => {
    const t = setup({
      textInRect: () => ({
        items: [
          { text: 'second line', x: 0, y: 40 },
          { text: 'world', x: 60, y: 12 },
          { text: 'Hello', x: 10, y: 10 },
          { text: 'Hello', x: 10, y: 80 }
        ]
      })
    })
    expect(await t.ta.textInRect({ x: 10, y: 20, width: 100, height: 50 })).toBe(
      'Hello world\nsecond line'
    )
    expect(t.calls[0]).toEqual({ cmd: 'textInRect', x: 15, y: 30, w: 150, h: 75, excludePid: 4242 })
  })

  it('nothing readable, an empty rect or a failed call → null', async () => {
    const t = setup({ textInRect: () => ({ items: [{ text: '  ', x: 0, y: 0 }] }) })
    expect(await t.ta.textInRect({ x: 0, y: 0, width: 50, height: 50 })).toBeNull()
    expect(await t.ta.textInRect({ x: 0, y: 0, width: 0, height: 50 })).toBeNull()
    expect(t.cmds()).toEqual(['textInRect'])
    expect(await setup().ta.textInRect({ x: 0, y: 0, width: 5, height: 5 })).toBeNull()
  })

  it('foreground() maps the helper reply', async () => {
    const t = setup({ foreground: () => APP })
    expect(await t.ta.foreground()).toEqual({ process: 'notepad', title: 'notes.txt - Notepad' })
    expect(await setup().ta.foreground()).toBeNull()
  })

  it('windowAt() asks in physical px with Hoot looked through; nothing there → null', async () => {
    const t = setup({
      windowAt: (a) =>
        a['x'] === 150
          ? { found: true, process: 'Code', title: 'a.ts - hoot - Visual Studio Code' }
          : { found: false }
    })
    expect(await t.ta.windowAt({ x: 100, y: 40 })).toEqual({
      process: 'Code',
      title: 'a.ts - hoot - Visual Studio Code'
    })
    expect(t.calls[0]).toEqual({ cmd: 'windowAt', x: 150, y: 60, excludePid: 4242 })
    expect(await t.ta.windowAt({ x: 1, y: 1 })).toBeNull()
    expect(await setup().ta.windowAt({ x: 1, y: 1 })).toBeNull()
    expect(await setup({}, { enabled: false }).ta.windowAt({ x: 1, y: 1 })).toBeNull()
  })
})

describe('createTextAccess: clicks', () => {
  it('watching starts with the first listener and stops with the last', async () => {
    const t = setup({ watchClicks: (a) => ({ on: a['on'] }) })
    const off1 = t.ta.onClick(() => undefined)
    // Not running yet: it starts, and the ready line turns the watch on.
    expect(t.helper.start).toHaveBeenCalledTimes(1)
    t.emit({ ready: true })
    const off2 = t.ta.onClick(() => undefined)
    expect(t.calls).toEqual([{ cmd: 'watchClicks', on: true }])
    off1()
    off1()
    expect(t.calls).toHaveLength(1)
    off2()
    expect(t.calls).toEqual([
      { cmd: 'watchClicks', on: true },
      { cmd: 'watchClicks', on: false }
    ])
    // A restarted helper only re-arms the watch while someone listens.
    t.emit({ ready: true })
    expect(t.calls).toHaveLength(2)
    t.ta.onClick(() => undefined)
    t.emit({ ready: true })
    expect(t.calls.filter((c) => c['on'] === true)).toHaveLength(3)
  })

  it('click events reach every listener in DIP; malformed ones are dropped', () => {
    const t = setup()
    const a: Point[] = []
    const b: Point[] = []
    const offA = t.ta.onClick((p) => a.push(p))
    t.ta.onClick(() => {
      throw new Error('listener bug')
    })
    t.ta.onClick((p) => b.push(p))
    t.emit({ event: 'click', x: 300, y: 150 })
    t.emit({ event: 'click', x: 'nope', y: 1 })
    t.emit({ event: 'other', x: 1, y: 1 })
    offA()
    t.emit({ event: 'click', x: 3, y: 6 })
    expect(a).toEqual([{ x: 200, y: 100 }])
    expect(b).toEqual([
      { x: 200, y: 100 },
      { x: 2, y: 4 }
    ])
  })

  it('click() converts DIP to physical px and reports success', async () => {
    const t = setup({ click: () => ({ done: true }) })
    expect(await t.ta.click({ x: 101, y: 50.4 })).toBe(true)
    expect(t.calls).toEqual([{ cmd: 'click', x: 152, y: 76 }])
    expect(await setup({ click: () => null }).ta.click({ x: 1, y: 1 })).toBe(false)
  })

  it("Hoot's own click is not reported as the user's", async () => {
    let t: ReturnType<typeof setup>
    const seen: Point[] = []
    // The watcher can see the click before the reply arrives.
    t = setup({
      click: () => {
        t.emit({ event: 'click', x: 151, y: 151 })
        return { done: true }
      }
    })
    t.ta.onClick((p) => seen.push(p))
    await t.ta.click({ x: 100, y: 100 })
    expect(seen).toEqual([])
    // Only that one click: a real one right after at the same spot counts.
    t.emit({ event: 'click', x: 150, y: 150 })
    expect(seen).toEqual([{ x: 100, y: 100 }])

    // After the reply: suppressed within 400 ms and 25 DIP only.
    t = setup({ click: () => ({ done: true }) })
    seen.length = 0
    t.ta.onClick((p) => seen.push(p))
    await t.ta.click({ x: 100, y: 100 })
    t.emit({ event: 'click', x: 300, y: 300 })
    t.tick(100)
    t.emit({ event: 'click', x: 160, y: 160 })
    expect(seen).toEqual([{ x: 200, y: 200 }])
    await t.ta.click({ x: 100, y: 100 })
    t.tick(401)
    t.emit({ event: 'click', x: 150, y: 150 })
    expect(seen).toEqual([
      { x: 200, y: 200 },
      { x: 100, y: 100 }
    ])
  })
})

describe('createTextAccess: lifecycle', () => {
  it('prewarm starts the helper after a delay; dispose cancels and disposes', () => {
    vi.useFakeTimers()
    const t = setup()
    t.ta.prewarm()
    t.ta.prewarm()
    vi.advanceTimersByTime(2999)
    expect(t.helper.start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(t.helper.start).toHaveBeenCalledTimes(1)

    const u = setup()
    u.ta.prewarm()
    u.ta.dispose()
    vi.advanceTimersByTime(10_000)
    expect(u.helper.start).not.toHaveBeenCalled()
    expect(u.helper.dispose).toHaveBeenCalledTimes(1)
  })

  it('after dispose every call resolves null without touching the helper', async () => {
    const t = setup({ foreground: () => APP })
    t.ta.dispose()
    expect(await t.ta.foreground()).toBeNull()
    expect(await t.ta.selection()).toBeNull()
    expect(t.helper.call).not.toHaveBeenCalled()
  })
})

describe('joinItems / cleanText / pixelRect', () => {
  it('reads rows top to bottom, left to right, without repeats, capped', () => {
    expect(
      joinItems([
        { text: 'c', x: 0, y: 30 },
        { text: 'b', x: 50, y: 3 },
        { text: 'a', x: 5, y: 0 },
        { text: 'b', x: 0, y: 60 },
        { text: '\r\n', x: 0, y: 0 }
      ])
    ).toBe('a b\nc')
    expect(joinItems([{ text: 'x'.repeat(TEXT_IN_RECT_MAX + 50), x: 0, y: 0 }])).toHaveLength(
      TEXT_IN_RECT_MAX
    )
  })

  it("drops Chromium's object marks and icon glyphs, and the blank runs they leave", () => {
    expect(cleanText('\uEA60 New session\r\n\uFFFC\r\n\uFFFC\r\n\r\nSessions  \r\n}\n}')).toBe(
      'New session\n\nSessions\n}\n}'
    )
  })

  it('covers fractional UI Automation rects with whole pixels', () => {
    expect(pixelRect({ x: 10.5, y: 3.2, w: 20, h: 10.1 })).toEqual({
      x: 10,
      y: 3,
      width: 21,
      height: 11
    })
  })
})
