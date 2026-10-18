import { createHash, randomUUID } from 'node:crypto'
import {
  countWords,
  LensBackendError,
  TRANSFORMS,
  type AnywhereAction,
  type AnywhereState,
  type BridgeErrorCode,
  type LensEventKind,
  type Point,
  type Rect,
  type Settings,
  type StudioView
} from '@hoot/core'
import type { LensService } from '../lens'
import type { Logger } from '../log'
import type { ForegroundApp, SelectionInfo } from '../textAccess'
import { buildAnywhereRequest, type AnywhereRequest } from './lensContext'
import {
  BUBBLE_MIN_HEIGHT,
  bubbleBounds,
  bubbleSide,
  clampBubbleHeight,
  cursorAnchor,
  unionRect,
  type BubbleSide
} from './placement'

/** The bubble window, behind an interface so the service is testable without Electron. */
export interface BubbleHost {
  /** Show at `bounds` without taking focus from the app the user is reading. */
  show(bounds: Rect): void
  setBounds(bounds: Rect): void
  hide(): void
  /** Push the state to the bubble's renderer. */
  update(state: AnywhereState): void
  isFocused(): boolean
  /** The bubble's own webContents: only it may act on the bubble. */
  owns(senderId: number): boolean
}

export interface AnywhereTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface AnywhereDeps {
  /** The selection in the foreground app (textAccess.selection). */
  readSelection(): Promise<SelectionInfo | null>
  lens: Pick<LensService, 'rewrite' | 'cancel' | 'feedback' | 'explain'>
  bubble: BubbleHost
  settings(): Settings
  /** The pointer, screen DIP. */
  cursor(): Point
  /** The work area of the display showing `rect`. */
  workArea(rect: Rect): Rect
  writeClipboard(text: string): void
  /** A sticky note with this Markdown. */
  pin(text: string): Promise<void>
  openStudio(view: StudioView): void
  log: Logger
  now?(): number
  newId?(): string
  timers?: AnywhereTimers
}

export interface AnywhereService {
  /** The Lens hotkey: read the selection, show the bubble, rewrite. A repeat starts over. */
  trigger(): Promise<void>
  current(senderId: number): AnywhereState | null
  resize(senderId: number, height: number): void
  act(senderId: number, action: AnywhereAction): Promise<void>
  close(senderId: number): Promise<void>
  /** The window went away on its own (Alt+F4): end like a close. */
  dismissed(): void
  dispose(): void
}

/** "Select some text first" hides itself after this long. */
export const EMPTY_HIDE_MS = 2500

const displayAccelerator = (a: string): string =>
  a.replace(/CommandOrControl|CmdOrCtrl|Command|Control/g, 'Ctrl')

export const ANYWHERE_COPY = {
  skipped: 'Nothing to change here — it already reads clearly.',
  tooLong:
    'That’s more than Lens rewrites at once. Select a sentence or a short paragraph, or ask Hoot to explain it.',
  empty: (hotkey: string): string =>
    `Select some text first, then press ${displayAccelerator(hotkey)}.`
}

type ErrorCopy = { message: string; action?: 'settings' | 'reading' | 'retry' }

const ERRORS: Partial<Record<BridgeErrorCode, ErrorCopy>> = {
  lens_off: { message: 'Lens is off. Turn it on in Hoot → Reading.', action: 'reading' },
  no_key: { message: 'Add your Claude key in Hoot settings to use Lens.', action: 'settings' },
  auth: {
    message: 'Anthropic rejected your Claude key. Check it in Hoot settings.',
    action: 'settings'
  },
  rate_limited: {
    message: 'Claude’s rate limit was reached. Wait a moment, then try again.',
    action: 'retry'
  },
  busy: { message: 'Claude is busy right now. Try again in a few seconds.', action: 'retry' },
  network: {
    message: 'Hoot couldn’t reach Claude. Check your connection, then try again.',
    action: 'retry'
  },
  blocked: { message: 'Claude declined to rewrite this text.' }
}

export function describeAnywhereError(code: BridgeErrorCode): ErrorCopy {
  return ERRORS[code] ?? { message: 'Hoot couldn’t rewrite this. Try again.', action: 'retry' }
}

type Fields = Partial<AnywhereState> & Pick<AnywhereState, 'status'>

const errorFields = (code: BridgeErrorCode): Fields => {
  const { message, action } = describeAnywhereError(code)
  return { status: 'error', message, error: action ? { code, action } : { code } }
}

/** Events never carry raw window titles: a hash of the app and title stands in for the URL. */
const urlHash = (app: ForegroundApp): string =>
  createHash('sha256').update(`${app.process}\n${app.title}`).digest('hex').slice(0, 128)

const defaultTimers: AnywhereTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout)
}

interface Active {
  sel: SelectionInfo
  req: AnywhereRequest
  reqId: string | null
  /** A rewrite rendered: later events (kept, knew_it, explain_more) are about it. */
  shown: boolean
}

/**
 * Lens anywhere: select text in any desktop app, press the Lens hotkey, and a
 * glass bubble under the selection shows a clearer version (hoot-lens.md
 * §9.4). One bubble at a time; each press replaces it and cancels whatever
 * the last one was still waiting for.
 */
export function createAnywhereService(deps: AnywhereDeps): AnywhereService {
  const { bubble, lens, log } = deps
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const timers = deps.timers ?? defaultTimers

  /** Bumps whenever a bubble ends, so late answers for it are dropped. */
  let seq = 0
  let state: AnywhereState | null = null
  let active: Active | null = null
  let visible = false
  let place: { anchor: Rect; area: Rect; side: BubbleSide } | null = null
  let height = BUBBLE_MIN_HEIGHT
  let emptyTimer: unknown = null

  const publish = (fields: Partial<AnywhereState>): void => {
    if (!state) return
    state = { ...state, ...fields }
    bubble.update(state)
  }

  const feedback = (a: Active, kind: LensEventKind, latencyMs = 0): void => {
    const result = state?.result
    if (!a.shown || !result) return
    const { ctx } = a.req
    lens
      .feedback({
        id: newId(),
        ts: Math.round(now()),
        site: '',
        urlHash: urlHash(a.sel.app),
        kind,
        transform: result.transform,
        mode: result.action,
        term: result.term,
        topic: ctx.headingPath[0] ?? null,
        lang: ctx.lang,
        spanWords: countWords(ctx.span),
        p: ctx.p,
        difficulty: null,
        latencyMs,
        cacheKey: result.cacheKey
      })
      .catch((e: unknown) => log.warn(`anywhere: feedback failed: ${String(e)}`))
  }

  /** End the current bubble's work: feedback about a shown change, cancel what's in flight. */
  const end = (kind: LensEventKind | null): void => {
    seq++
    if (emptyTimer !== null) timers.clearTimeout(emptyTimer)
    emptyTimer = null
    const a = active
    active = null
    if (!a) return
    if (kind) feedback(a, kind)
    if (a.reqId) lens.cancel(a.reqId)
  }

  const hide = (): void => {
    if (!visible) return
    visible = false
    bubble.hide()
  }

  const finish = (kind: LensEventKind | null): void => {
    end(kind)
    hide()
  }

  const open = (id: number, anchor: Rect, fields: Fields): void => {
    const area = deps.workArea(anchor)
    const side = bubbleSide(anchor, area)
    place = { anchor, area, side }
    state = { id, original: '', app: '', result: null, message: null, error: null, side, ...fields }
    bubble.update(state)
    const bounds = bubbleBounds(anchor, height, side, area)
    if (visible) bubble.setBounds(bounds)
    else {
      visible = true
      bubble.show(bounds)
    }
  }

  const run = async (mine: number): Promise<void> => {
    const a = active
    if (!a) return
    const reqId = newId()
    a.reqId = reqId
    try {
      const outcome = await lens.rewrite(reqId, {
        ctx: a.req.ctx,
        allowedTransforms: [...TRANSFORMS],
        risk: a.req.risk
      })
      if (mine !== seq) return
      if (outcome.kind === 'rewritten') {
        publish({ status: 'done', result: outcome.result, message: null, error: null })
        a.shown = true
        feedback(a, 'shown', outcome.result.latencyMs)
      } else if (outcome.reason === 'lens_off') {
        publish(errorFields('lens_off'))
      } else if (outcome.reason !== 'cancelled') {
        publish({ status: 'skipped', message: ANYWHERE_COPY.skipped, error: null })
      }
    } catch (e) {
      if (mine !== seq) return
      log.warn(`anywhere: rewrite failed: ${String(e)}`)
      publish(errorFields(e instanceof LensBackendError ? e.code : 'internal'))
    } finally {
      if (a.reqId === reqId) a.reqId = null
    }
  }

  return {
    async trigger() {
      end('kept')
      const mine = seq
      // A focused bubble would get the simulated Ctrl+C: hand focus back to the app first.
      if (visible && bubble.isFocused()) hide()
      const settings = deps.settings()
      // Lens off: nothing would be sent, so don't read the selection either.
      if (!settings.lens.enabled) {
        open(mine, cursorAnchor(deps.cursor()), errorFields('lens_off'))
        return
      }
      const sel = await deps.readSelection().catch((e: unknown) => {
        log.warn(`anywhere: reading the selection failed: ${String(e)}`)
        return null
      })
      if (mine !== seq) return
      const req = sel ? buildAnywhereRequest(sel) : null
      const anchor = (sel && unionRect(sel.rects)) ?? cursorAnchor(deps.cursor())
      if (!sel || !req) {
        open(mine, anchor, { status: 'empty', message: ANYWHERE_COPY.empty(settings.lensHotkey) })
        emptyTimer = timers.setTimeout(() => {
          if (mine === seq) finish(null)
        }, EMPTY_HIDE_MS)
        return
      }
      active = { sel, req, reqId: null, shown: false }
      const base = { original: sel.text, app: sel.app.process }
      if (req.tooLong) {
        open(mine, anchor, { ...base, status: 'skipped', message: ANYWHERE_COPY.tooLong })
        return
      }
      open(mine, anchor, { ...base, status: 'loading' })
      await run(mine)
    },

    current: (senderId) => (bubble.owns(senderId) ? state : null),

    resize(senderId, h) {
      if (!bubble.owns(senderId)) return
      height = clampBubbleHeight(h)
      if (visible && place)
        bubble.setBounds(bubbleBounds(place.anchor, height, place.side, place.area))
    },

    async act(senderId, action) {
      if (!bubble.owns(senderId)) return
      const a = active
      const result = state?.status === 'done' ? state.result : null
      switch (action) {
        case 'copy':
          if (result) deps.writeClipboard(result.text)
          return
        case 'pin': {
          if (!a || !result) return
          const text = `**${a.sel.text.replace(/\s+/g, ' ')}**\n\n${result.text}`
          finish('kept')
          return deps.pin(text)
        }
        case 'explain':
        case 'chat':
          if (!a) return
          finish('explain_more')
          if (action === 'chat') deps.openStudio('chat')
          return lens.explain(a.req.ctx)
        case 'knewIt':
          finish('knew_it')
          return
        case 'retry':
          if (!a || state?.status !== 'error') return
          publish({ status: 'loading', message: null, error: null })
          return run(seq)
        case 'settings':
        case 'reading':
          finish(null)
          deps.openStudio(action)
      }
    },

    async close(senderId) {
      if (bubble.owns(senderId)) finish('kept')
    },

    dismissed() {
      visible = false
      end('kept')
    },

    dispose: () => end(null)
  }
}
