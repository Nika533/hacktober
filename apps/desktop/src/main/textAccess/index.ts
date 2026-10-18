import { screen } from 'electron'
import type { Point, Rect } from '@hoot/core'
import type { Logger } from '../log'
import { createHelper, type Helper, type Reply } from './helper'
import { cleanText, joinItems, pixelRect, type RectItem } from './text'
import type { ForegroundApp, SelectionInfo, TextAccess } from './types'

export type { ForegroundApp, SelectionInfo, TextAccess } from './types'
export { TEXT_IN_RECT_MAX } from './types'

/** Physical screen px ↔ screen DIP. */
export interface ScreenSeam {
  rectToDip(rect: Rect): Rect
  rectToScreen(rect: Rect): Rect
  pointToDip(point: Point): Point
  pointToScreen(point: Point): Point
}

export interface TextAccessDeps {
  log: Logger
  /** False under HOOT_TEST and off Windows: every call resolves null. */
  enabled: boolean
  /** Seams for tests; the defaults are the PowerShell helper and Electron's screen. */
  helper?: Helper
  screen?: ScreenSeam
  /** The process owning Hoot's windows (main): textInRect looks through them. */
  selfPid?: number
  prewarmDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Callers truncate further; this only bounds what crosses the pipe. */
export const SELECTION_MAX = 20_000
export const PREWARM_DELAY_MS = 3_000
/** The copied text gets POLLS × POLL_MS (~600 ms) to land on the clipboard. */
const POLL_MS = 25
const POLLS = 24
/** A click event this close (DIP) to Hoot's own click, this soon after it, is that click. */
const SELF_CLICK_MS = 400
const SELF_CLICK_DIP = 25

const electronScreen: ScreenSeam = {
  rectToDip: (r) => screen.screenToDipRect(null, r),
  rectToScreen: (r) => screen.dipToScreenRect(null, r),
  pointToDip: (p) => screen.screenToDipPoint(p),
  pointToScreen: (p) => screen.dipToScreenPoint(p)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const appOf = (r: Reply): ForegroundApp => ({ process: str(r['process']), title: str(r['title']) })
const round = (r: Rect): Rect => pixelRect({ x: r.x, y: r.y, w: r.width, h: r.height })

const boxes = (v: unknown): Rect[] =>
  (Array.isArray(v) ? v : []).flatMap((b: unknown) => {
    if (!isObj(b)) return []
    const [x, y, w, h] = [num(b['x']), num(b['y']), num(b['w']), num(b['h'])]
    return x === null || y === null || !w || !h || w < 0 || h < 0 ? [] : [pixelRect({ x, y, w, h })]
  })

const items = (v: unknown): RectItem[] =>
  (Array.isArray(v) ? v : []).flatMap((it: unknown) =>
    isObj(it) && typeof it['text'] === 'string'
      ? [{ text: it['text'], x: num(it['x']) ?? 0, y: num(it['y']) ?? 0 }]
      : []
  )

const DISABLED: TextAccess = {
  selection: async () => null,
  textInRect: async () => null,
  foreground: async () => null,
  onClick: () => () => undefined,
  click: async () => false,
  prewarm: () => undefined,
  dispose: () => undefined
}

/**
 * Text and input in other desktop apps, through a hidden PowerShell helper
 * (UI Automation + user32; see script.ts). Never blocks main: every call has
 * a timeout and resolves null (or false) when anything goes wrong.
 */
export function createTextAccess(deps: TextAccessDeps): TextAccess {
  if (!deps.enabled) return DISABLED
  const { log } = deps
  const helper = deps.helper ?? createHelper({ log })
  const scr = deps.screen ?? electronScreen
  const selfPid = deps.selfPid ?? process.pid
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const clickListeners = new Set<(at: Point) => void>()
  let disposed = false
  let inflight: Promise<SelectionInfo | null> | null = null
  let prewarmTimer: ReturnType<typeof setTimeout> | undefined
  let selfClick: { at: Point; until: number } | null = null

  const guard = async <T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    if (disposed) return fallback
    try {
      return await fn()
    } catch (e) {
      log.warn(`textAccess: ${what} failed: ${String(e)}`)
      return fallback
    }
  }

  /** Ctrl+C into the foreground app, the user's clipboard snapshotted first and always put back. */
  async function copySelection(): Promise<string> {
    const token = num((await helper.call('clipSave'))?.['token']) ?? -1
    // A clipboard that couldn't be snapshotted is never touched.
    if (token < 0) return ''
    try {
      if ((await helper.call('clipClear'))?.['done'] !== true) return ''
      if ((await helper.call('copy'))?.['sent'] !== true) return ''
      for (let i = 0; i < POLLS; i++) {
        await sleep(POLL_MS)
        const text = cleanText(str((await helper.call('clipText'))?.['text']), SELECTION_MAX)
        if (text) return text
      }
      return ''
    } finally {
      const restored = await helper.call('clipRestore', { token })
      if (restored?.['done'] !== true) log.warn('textAccess: clipboard restore failed')
    }
  }

  async function readSelection(): Promise<SelectionInfo | null> {
    const sel = await helper.call('selection')
    const text = cleanText(str(sel?.['text']), SELECTION_MAX)
    if (sel && text) {
      const paragraph = cleanText(str(sel['paragraph']))
      return {
        text,
        paragraph: paragraph.includes(text) ? paragraph : '',
        rects: boxes(sel['rects']).map((r) => scr.rectToDip(r)),
        app: appOf(sel),
        source: 'uia'
      }
    }
    const fg = sel ?? (await helper.call('foreground'))
    // Ctrl+C in a terminal with nothing selected is an interrupt.
    if (!fg || fg['terminal'] === true) return null
    const copied = await copySelection()
    return copied
      ? { text: copied, paragraph: '', rects: [], app: appOf(fg), source: 'clipboard' }
      : null
  }

  const setWatch = (on: boolean): void => {
    if (disposed) return
    // A starting helper gets the watch from its ready line.
    if (helper.running()) void helper.call('watchClicks', { on })
    else if (on) helper.start()
  }

  helper.listen((msg) => {
    if (msg['ready'] === true) {
      if (clickListeners.size > 0) void helper.call('watchClicks', { on: true })
      return
    }
    if (msg['event'] !== 'click' || clickListeners.size === 0) return
    const x = num(msg['x'])
    const y = num(msg['y'])
    if (x === null || y === null) return
    const at = scr.pointToDip({ x, y })
    const self = selfClick
    if (
      self &&
      now() <= self.until &&
      Math.hypot(at.x - self.at.x, at.y - self.at.y) <= SELF_CLICK_DIP
    ) {
      selfClick = null
      return
    }
    for (const listener of [...clickListeners]) {
      try {
        listener(at)
      } catch (e) {
        log.warn(`textAccess: click listener threw: ${String(e)}`)
      }
    }
  })

  return {
    selection() {
      inflight ??= guard('selection', null, readSelection).finally(() => {
        inflight = null
      })
      return inflight
    },

    textInRect(rect) {
      return guard('textInRect', null, async () => {
        const r = scr.rectToScreen(round(rect))
        if (r.width < 1 || r.height < 1) return null
        const reply = await helper.call('textInRect', {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          excludePid: selfPid
        })
        return joinItems(items(reply?.['items'])) || null
      })
    },

    foreground() {
      return guard('foreground', null, async () => {
        const r = await helper.call('foreground')
        return r ? appOf(r) : null
      })
    },

    onClick(listener) {
      if (disposed) return () => undefined
      clickListeners.add(listener)
      if (clickListeners.size === 1) setWatch(true)
      return () => {
        if (clickListeners.delete(listener) && clickListeners.size === 0) setWatch(false)
      }
    },

    click(at) {
      return guard('click', false, async () => {
        const p = scr.pointToScreen(at)
        // The watcher can report it before the reply lands.
        const self = { at, until: Infinity }
        selfClick = self
        const r = await helper.call('click', { x: Math.round(p.x), y: Math.round(p.y) })
        self.until = now() + SELF_CLICK_MS
        return r?.['done'] === true
      })
    },

    prewarm() {
      if (disposed || prewarmTimer) return
      prewarmTimer = setTimeout(() => helper.start(), deps.prewarmDelayMs ?? PREWARM_DELAY_MS)
      prewarmTimer.unref?.()
    },

    dispose() {
      disposed = true
      clearTimeout(prewarmTimer)
      clickListeners.clear()
      helper.dispose()
    }
  }
}
