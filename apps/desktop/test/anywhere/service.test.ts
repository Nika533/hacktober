import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  LensBackendError,
  TRANSFORMS,
  type AnywhereState,
  type LensContext,
  type LensEvent,
  type Rect,
  type RewriteOutcome,
  type RewriteRequest,
  type RewriteResult,
  type Settings,
  type StudioView
} from '@hoot/core'
import { LensContextSchema, LensEventSchema } from '@hoot/core/schemas'
import {
  ANYWHERE_COPY,
  EMPTY_HIDE_MS,
  createAnywhereService,
  type AnywhereService,
  type AnywhereTimers,
  type BubbleHost
} from '../../src/main/anywhere/service'
import { BUBBLE_GAP, BUBBLE_MARGIN } from '../../src/main/anywhere/placement'
import type { SelectionInfo } from '../../src/main/textAccess'

const BUBBLE = 7
const AREA: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

const SEL: SelectionInfo = {
  text: 'The endpoint is idempotent, so retries are safe.',
  paragraph:
    'Network calls can fail. The endpoint is idempotent, so retries are safe. Use backoff.',
  rects: [
    { x: 300, y: 200, width: 280, height: 20 },
    { x: 120, y: 220, width: 160, height: 20 }
  ],
  app: { process: 'Code', title: 'api.md - Visual Studio Code' },
  source: 'uia'
}

const RESULT: RewriteResult = {
  action: 'replace',
  transform: 'simplify',
  text: 'You can safely retry: repeating the call changes nothing.',
  term: 'idempotent',
  confidence: 0.9,
  cacheKey: 'k-123',
  latencyMs: 42,
  cached: false
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const lensOn = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...over,
  lens: { ...DEFAULT_SETTINGS.lens, enabled: true }
})

interface Pending {
  reqId: string
  req: RewriteRequest
  resolve(o: RewriteOutcome): void
  reject(e: unknown): void
}

type FakeBubble = BubbleHost & { visible: boolean; focused: boolean; hides: number }
type FakeTimers = AnywhereTimers & { fire(): void; pending(): number }

interface Harness {
  service: AnywhereService
  bubble: FakeBubble
  states: AnywhereState[]
  last(): AnywhereState
  shown: Rect[]
  bounds: Rect[]
  pending: Pending[]
  rewrites: [string, RewriteRequest][]
  cancelled: string[]
  events: LensEvent[]
  explained: LensContext[]
  studio: StudioView[]
  pinned: string[]
  copied: string[]
  timers: FakeTimers
  reads(): number
  select(s: SelectionInfo | null): void
}

function setup(
  opts: {
    selection?: SelectionInfo | null
    settings?: Settings
    rewrite?: (reqId: string, req: RewriteRequest) => Promise<RewriteOutcome>
  } = {}
): Harness {
  let selection = opts.selection === undefined ? SEL : opts.selection
  const settings = opts.settings ?? lensOn()
  const states: AnywhereState[] = []
  const shown: Rect[] = []
  const bounds: Rect[] = []
  const pending: Pending[] = []
  const rewrites: [string, RewriteRequest][] = []
  const cancelled: string[] = []
  const events: LensEvent[] = []
  const explained: LensContext[] = []
  const studio: StudioView[] = []
  const pinned: string[] = []
  const copied: string[] = []
  const timers: FakeTimers = (() => {
    const queue: { fn: () => void }[] = []
    return {
      setTimeout: (fn) => {
        const h = { fn }
        queue.push(h)
        return h
      },
      clearTimeout: (h) => {
        const i = queue.indexOf(h as { fn: () => void })
        if (i >= 0) queue.splice(i, 1)
      },
      pending: () => queue.length,
      fire: () => {
        for (const h of queue.splice(0)) h.fn()
      }
    }
  })()
  const bubble: FakeBubble = {
    visible: false,
    focused: false,
    hides: 0,
    show(r) {
      bubble.visible = true
      shown.push(r)
    },
    setBounds: (r) => void bounds.push(r),
    hide() {
      bubble.visible = false
      bubble.hides++
    },
    update: (s) => void states.push(s),
    isFocused: () => bubble.focused,
    owns: (id) => id === BUBBLE
  }
  let reads = 0
  let ids = 0
  const service: AnywhereService = createAnywhereService({
    readSelection: async () => {
      reads++
      return selection
    },
    lens: {
      rewrite: (reqId, req) => {
        rewrites.push([reqId, req])
        if (opts.rewrite) return opts.rewrite(reqId, req)
        return new Promise((resolve, reject) => pending.push({ reqId, req, resolve, reject }))
      },
      // Like the engine: a cancelled request resolves `skipped: cancelled`.
      cancel: (reqId) => {
        cancelled.push(reqId)
        pending.find((p) => p.reqId === reqId)?.resolve({ kind: 'skipped', reason: 'cancelled' })
      },
      feedback: async (e) => void events.push(e),
      explain: async (ctx) => void explained.push(ctx)
    },
    bubble,
    settings: () => settings,
    cursor: () => ({ x: 900, y: 500 }),
    workArea: () => AREA,
    writeClipboard: (t) => void copied.push(t),
    pin: async (t) => void pinned.push(t),
    openStudio: (v) => void studio.push(v),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => 1_700_000_000_000,
    newId: () => `id-${++ids}`,
    timers
  })
  const last = (): AnywhereState => states[states.length - 1]!
  return {
    service,
    bubble,
    states,
    last,
    shown,
    bounds,
    pending,
    rewrites,
    cancelled,
    events,
    explained,
    studio,
    pinned,
    copied,
    timers,
    reads: () => reads,
    select: (s) => {
      selection = s
    }
  }
}

/** Trigger and let the selection read settle; the rewrite stays pending until resolved. */
async function press(t: ReturnType<typeof setup>): Promise<{ done: Promise<void> }> {
  const done = t.service.trigger()
  await flush()
  return { done }
}

async function showResult(t: ReturnType<typeof setup>): Promise<void> {
  const { done } = await press(t)
  t.pending[t.pending.length - 1]!.resolve({ kind: 'rewritten', result: RESULT })
  await done
}

describe('Lens anywhere: reading the selection', () => {
  it('nothing selected: says so near the pointer, then hides by itself', async () => {
    const t = setup({ selection: null })
    await t.service.trigger()
    expect(t.last()).toMatchObject({
      status: 'empty',
      message: 'Select some text first, then press Ctrl+Alt+L.',
      original: '',
      result: null
    })
    expect(t.rewrites).toHaveLength(0)
    expect(t.shown[0]).toMatchObject({ x: 900 - BUBBLE_MARGIN })
    expect(t.shown[0]!.y).toBeGreaterThan(500)
    expect(t.timers.pending()).toBe(1)
    t.timers.fire() // EMPTY_HIDE_MS
    expect(EMPTY_HIDE_MS).toBe(2500)
    expect(t.bubble.visible).toBe(false)
  })

  it('shows loading under the selection, then the rewrite, from a valid LensContext', async () => {
    const t = setup()
    const { done } = await press(t)
    expect(t.last()).toMatchObject({
      status: 'loading',
      original: SEL.text,
      app: 'Code',
      side: 'below'
    })
    // Under the union of the selection's rects, the card BUBBLE_GAP below it.
    expect(t.shown[0]).toMatchObject({
      x: 120 - BUBBLE_MARGIN,
      y: 240 + BUBBLE_GAP - BUBBLE_MARGIN
    })

    const [reqId, req] = t.rewrites[0]!
    expect(reqId).toBe('id-1')
    expect(req.allowedTransforms).toEqual([...TRANSFORMS])
    expect(req.risk).toBe('normal')
    expect(LensContextSchema.safeParse(req.ctx).success).toBe(true)
    expect(req.ctx).toMatchObject({
      span: SEL.text,
      paragraph: SEL.paragraph,
      title: SEL.app.title,
      headingPath: ['Code'],
      site: '',
      surface: 'app',
      p: 1
    })

    t.pending[0]!.resolve({ kind: 'rewritten', result: RESULT })
    await done
    expect(t.last()).toMatchObject({ status: 'done', result: RESULT, message: null, error: null })
  })

  it('a model skip offers to explain anyway', async () => {
    const t = setup({ rewrite: async () => ({ kind: 'skipped', reason: 'model_skip' }) })
    await t.service.trigger()
    expect(t.last()).toMatchObject({ status: 'skipped', message: ANYWHERE_COPY.skipped })
    expect(ANYWHERE_COPY.skipped).toBe('Nothing to change here — it already reads clearly.')
    await t.service.act(BUBBLE, 'explain')
    expect(t.explained).toHaveLength(1)
    expect(t.explained[0]!.span).toBe(SEL.text)
    expect(t.events).toHaveLength(0)
    expect(t.bubble.visible).toBe(false)
  })

  it('too long a selection skips the rewrite but can still be explained', async () => {
    const t = setup({ selection: { ...SEL, text: 'word '.repeat(200).trim() } })
    await t.service.trigger()
    expect(t.rewrites).toHaveLength(0)
    expect(t.last()).toMatchObject({ status: 'skipped', message: ANYWHERE_COPY.tooLong })
    await t.service.act(BUBBLE, 'explain')
    expect(t.explained[0]!.span.length).toBeLessThanOrEqual(600)
  })
})

describe('Lens anywhere: errors', () => {
  it('no key: friendly copy and a button to Settings', async () => {
    const t = setup({ rewrite: () => Promise.reject(new LensBackendError('no_key')) })
    await t.service.trigger()
    expect(t.last()).toMatchObject({
      status: 'error',
      message: 'Add your Claude key in Hoot settings to use Lens.',
      error: { code: 'no_key', action: 'settings' }
    })
    await t.service.act(BUBBLE, 'settings')
    expect(t.studio).toEqual(['settings'])
    expect(t.bubble.visible).toBe(false)
  })

  it('maps auth, rate limits and unknown failures', async () => {
    for (const [error, code, action] of [
      [new LensBackendError('auth'), 'auth', 'settings'],
      [new LensBackendError('rate_limited'), 'rate_limited', 'retry'],
      [new Error('boom'), 'internal', 'retry']
    ] as const) {
      const t = setup({ rewrite: () => Promise.reject(error) })
      await t.service.trigger()
      expect(t.last().error).toEqual({ code, action })
    }
  })

  it('retry re-runs a failed rewrite on the same selection', async () => {
    let calls = 0
    const t = setup({
      rewrite: async () =>
        ++calls === 1
          ? Promise.reject(new LensBackendError('busy'))
          : { kind: 'rewritten', result: RESULT }
    })
    await t.service.trigger()
    expect(t.last().status).toBe('error')
    await t.service.act(BUBBLE, 'retry')
    expect(t.rewrites).toHaveLength(2)
    expect(t.rewrites[1]![1].ctx).toEqual(t.rewrites[0]![1].ctx)
    expect(t.last()).toMatchObject({ status: 'done', result: RESULT })
  })

  it('Lens off: says so without reading the selection, with a button to Reading', async () => {
    const t = setup({ settings: DEFAULT_SETTINGS })
    await t.service.trigger()
    expect(t.reads()).toBe(0)
    expect(t.last()).toMatchObject({
      status: 'error',
      message: 'Lens is off. Turn it on in Hoot → Reading.',
      error: { code: 'lens_off', action: 'reading' }
    })
    await t.service.act(BUBBLE, 'reading')
    expect(t.studio).toEqual(['reading'])
  })

  it('the engine’s lens_off skip shows the same message', async () => {
    const t = setup({ rewrite: async () => ({ kind: 'skipped', reason: 'lens_off' }) })
    await t.service.trigger()
    expect(t.last().error).toEqual({ code: 'lens_off', action: 'reading' })
  })
})

describe('Lens anywhere: one bubble at a time', () => {
  it('a second press cancels the first request and starts over with the new selection', async () => {
    const t = setup()
    const { done: first } = await press(t)
    const firstId = t.last().id
    t.select({
      ...SEL,
      text: 'exponential backoff',
      rects: [{ x: 50, y: 600, width: 90, height: 18 }]
    })
    const { done: second } = await press(t)
    expect(t.cancelled).toEqual(['id-1'])
    await first
    expect(t.rewrites).toHaveLength(2)
    expect(t.last()).toMatchObject({ status: 'loading', original: 'exponential backoff' })
    expect(t.last().id).not.toBe(firstId)
    // Still the same window: moved, not re-shown.
    expect(t.shown).toHaveLength(1)
    expect(t.bounds.length).toBeGreaterThan(0)
    t.pending[1]!.resolve({ kind: 'rewritten', result: RESULT })
    await second
    expect(t.last()).toMatchObject({ status: 'done', original: 'exponential backoff' })
  })

  it('hands focus back before reading when the bubble has it', async () => {
    const t = setup()
    await showResult(t)
    t.bubble.focused = true
    const { done: again } = await press(t)
    expect(t.bubble.hides).toBe(1)
    expect(t.shown).toHaveLength(2)
    t.pending[1]!.resolve({ kind: 'skipped', reason: 'model_skip' })
    await again
  })

  it('closing cancels what is in flight and drops the late answer', async () => {
    const t = setup()
    const { done } = await press(t)
    await t.service.close(BUBBLE)
    expect(t.cancelled).toEqual(['id-1'])
    expect(t.bubble.visible).toBe(false)
    await done
    expect(t.last().status).toBe('loading')
    expect(t.events).toHaveLength(0)
  })

  it('ignores every window but the bubble', async () => {
    const t = setup()
    await showResult(t)
    expect(t.service.current(99)).toBeNull()
    expect(t.service.current(BUBBLE)).toMatchObject({ status: 'done' })
    await t.service.act(99, 'copy')
    await t.service.close(99)
    t.service.resize(99, 300)
    expect(t.copied).toHaveLength(0)
    expect(t.bubble.visible).toBe(true)
    const before = t.bounds.length
    t.service.resize(BUBBLE, 300)
    expect(t.bounds).toHaveLength(before + 1)
    expect(t.bounds[t.bounds.length - 1]!.height).toBe(300)
  })
})

describe('Lens anywhere: actions and feedback', () => {
  const kinds = (t: ReturnType<typeof setup>): string[] => t.events.map((e) => e.kind)

  it('sends a valid `shown` event, then `kept` on a normal close', async () => {
    const t = setup()
    await showResult(t)
    expect(kinds(t)).toEqual(['shown'])
    const shown = t.events[0]!
    expect(LensEventSchema.safeParse(shown).success).toBe(true)
    expect(shown).toMatchObject({
      site: '',
      transform: 'simplify',
      mode: 'replace',
      term: 'idempotent',
      topic: 'Code',
      lang: 'und',
      spanWords: 8,
      p: 1,
      difficulty: null,
      latencyMs: 42,
      cacheKey: 'k-123'
    })
    expect(shown.urlHash).toMatch(/^[0-9a-f]{64}$/)
    await t.service.close(BUBBLE)
    expect(kinds(t)).toEqual(['shown', 'kept'])
    expect(t.events[1]!.latencyMs).toBe(0)
    expect(LensEventSchema.safeParse(t.events[1]).success).toBe(true)
  })

  it('a new press keeps the last change too', async () => {
    const t = setup()
    await showResult(t)
    const { done: again } = await press(t)
    expect(kinds(t)).toEqual(['shown', 'kept'])
    t.pending[1]!.resolve({ kind: 'skipped', reason: 'model_skip' })
    await again
  })

  it('I knew this: knew_it, then closes without kept', async () => {
    const t = setup()
    await showResult(t)
    await t.service.act(BUBBLE, 'knewIt')
    expect(kinds(t)).toEqual(['shown', 'knew_it'])
    expect(t.bubble.visible).toBe(false)
  })

  it('Explain more: explain_more, closes, and the app explains the same context', async () => {
    const t = setup()
    await showResult(t)
    await t.service.act(BUBBLE, 'explain')
    expect(kinds(t)).toEqual(['shown', 'explain_more'])
    expect(t.explained[0]).toEqual(t.rewrites[0]![1].ctx)
    expect(t.studio).toEqual([])
    expect(t.bubble.visible).toBe(false)
  })

  it('Open in chat: Studio’s chat, then the same explanation', async () => {
    const t = setup()
    await showResult(t)
    await t.service.act(BUBBLE, 'chat')
    expect(t.studio).toEqual(['chat'])
    expect(kinds(t)).toEqual(['shown', 'explain_more'])
    expect(t.explained).toHaveLength(1)
  })

  it('Copy writes the rewrite and keeps the bubble open', async () => {
    const t = setup()
    await showResult(t)
    await t.service.act(BUBBLE, 'copy')
    expect(t.copied).toEqual([RESULT.text])
    expect(t.bubble.visible).toBe(true)
  })

  it('Pin makes a note with the original in bold, then closes as kept', async () => {
    const t = setup()
    await showResult(t)
    await t.service.act(BUBBLE, 'pin')
    expect(t.pinned).toEqual([`**${SEL.text}**\n\n${RESULT.text}`])
    expect(kinds(t)).toEqual(['shown', 'kept'])
    expect(t.bubble.visible).toBe(false)
  })

  it('dispose cancels without sending anything', async () => {
    const t = setup()
    const { done } = await press(t)
    t.service.dispose()
    await done
    expect(t.cancelled).toEqual(['id-1'])
    expect(t.events).toHaveLength(0)
  })
})
