import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LensBackend,
  LensFeedback,
  LensSettingsView,
  RewriteRequest,
  RewriteResult
} from '../src/contract'
import { createLens, pageBlockReason, type Lens } from '../src/controller'
import { UI_TAG } from '../src/guard'
import { loadArticle, rangeForText, textNodes } from './helpers'

const ENABLED: LensSettingsView = {
  enabled: true,
  mode: 'ask',
  copy: 'original',
  highStakes: 'gloss'
}

class FakeBackend implements LensBackend {
  settings: LensSettingsView = { ...ENABLED }
  requests: Array<{ reqId: string; request: RewriteRequest }> = []
  feedbackEvents: LensFeedback[] = []
  cancelled: string[] = []
  explained: unknown[] = []
  next: RewriteResult | Error = {
    kind: 'rewritten',
    action: 'replace',
    transform: 'define',
    text: 'heteroscedasticity (unequal spread of errors)',
    term: 'heteroscedasticity',
    confidence: 0.9,
    cacheKey: 'k1'
  }
  #listeners = new Set<(settings: LensSettingsView) => void>()

  assess = vi.fn(async () => ({ difficulty: 0.7, reason: 'jargon' as const, term: null }))
  async rewrite(reqId: string, request: RewriteRequest): Promise<RewriteResult> {
    this.requests.push({ reqId, request })
    if (this.next instanceof Error) throw this.next
    return this.next
  }
  cancel(reqId: string): void {
    this.cancelled.push(reqId)
  }
  feedback(event: LensFeedback): void {
    this.feedbackEvents.push(event)
  }
  async getProfile(): Promise<{ summary: string; version: number }> {
    return { summary: '', version: 1 }
  }
  async getSettings(): Promise<LensSettingsView> {
    return this.settings
  }
  onSettings(listener: (settings: LensSettingsView) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  explainMore(request: unknown): void {
    this.explained.push(request)
  }
  push(settings: LensSettingsView): void {
    this.settings = settings
    for (const listener of this.#listeners) listener(settings)
  }
}

let article: HTMLElement
let backend: FakeBackend
let lens: Lens
const now = 0

const shadow = (): ShadowRoot => document.documentElement.querySelector(UI_TAG)!.shadowRoot!
const chip = (): HTMLButtonElement => shadow().querySelector('[data-action="ask"]')!

function select(needle: string): void {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(rangeForText(article, needle))
  document.dispatchEvent(new Event('selectionchange'))
  vi.advanceTimersByTime(300)
}

async function start(options: Partial<Parameters<typeof createLens>[0]> = {}): Promise<void> {
  lens = createLens({
    document,
    backend,
    shadowMode: 'open',
    renderer: 'inline',
    animate: false,
    trustedOnly: false,
    now: () => now,
    ...options
  })
  await lens.ready
}

beforeEach(() => {
  vi.useFakeTimers()
  document.documentElement.querySelectorAll(UI_TAG).forEach((node) => node.remove())
  article = loadArticle()
  backend = new FakeBackend()
})

afterEach(() => {
  lens.destroy()
  vi.useRealTimers()
})

describe('createLens: Ask-first', () => {
  it('shows the chip on a settled selection and rewrites on ask', async () => {
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(false)
    const mark = await lens.ask()
    expect(mark?.anchor.textContent).toBe('heteroscedasticity (unequal spread of errors)')
    expect(backend.requests[0]?.request).toMatchObject({
      span: 'heteroscedasticity',
      headingPath: ['Reading regression output', 'Residuals'],
      title: 'Reading regression output',
      lang: 'en',
      risk: 'normal'
    })
    expect(shadow().querySelector('.pill .status')?.textContent).toBe('Hoot changed 1 thing')
    expect(backend.feedbackEvents.map((event) => event.kind)).toEqual(['shown'])
    expect(backend.feedbackEvents[0]).toMatchObject({
      mode: 'ask',
      transform: 'define',
      lang: 'en'
    })
  })

  it('reports restore and "I knew this" as feedback and restores exactly', async () => {
    const html = article.innerHTML
    const nodes = textNodes(article)
    await start()
    select('heteroscedasticity')
    const first = await lens.ask()
    lens.ui.popover.show(first!)
    ;(shadow().querySelector('[data-action="knewIt"]') as HTMLButtonElement).click()
    select('standard errors')
    await lens.ask()
    lens.undoLast()
    expect(backend.feedbackEvents.map((event) => event.kind)).toEqual([
      'shown',
      'knew_it',
      'shown',
      'reverted'
    ])
    expect(article.innerHTML).toBe(html)
    expect(textNodes(article)).toEqual(nodes)
    expect(lens.marks()).toHaveLength(0)
  })

  it('passes span and paragraph to Explain more', async () => {
    await start()
    select('heteroscedasticity')
    const mark = await lens.ask()
    lens.ui.popover.show(mark!)
    ;(shadow().querySelector('[data-action="explainMore"]') as HTMLButtonElement).click()
    expect(backend.explained).toEqual([
      {
        span: 'heteroscedasticity',
        paragraph: expect.stringContaining('the model shows heteroscedasticity, and the usual'),
        title: 'Reading regression output'
      }
    ])
    expect(backend.feedbackEvents.at(-1)?.kind).toBe('explain_more')
  })

  it('forces a gloss on high-stakes pages and in gloss-only mode', async () => {
    await start({ risk: () => 'high' })
    select('heteroscedasticity')
    const mark = await lens.ask()
    expect(mark?.spec).toMatchObject({ action: 'gloss', highStakes: true })
    expect(backend.requests[0]?.request.risk).toBe('high')
    lens.destroy()

    article = loadArticle()
    backend = new FakeBackend()
    backend.settings = { ...ENABLED, mode: 'gloss' }
    await start()
    select('heteroscedasticity')
    expect((await lens.ask())?.spec.action).toBe('gloss')
  })

  it('does nothing when the backend skips or fails', async () => {
    backend.next = { kind: 'skipped', reason: 'low-confidence' }
    await start()
    select('heteroscedasticity')
    expect(await lens.ask()).toBeNull()
    backend.next = new Error('bridge down')
    select('standard errors')
    expect(await lens.ask()).toBeNull()
    expect(lens.marks()).toHaveLength(0)
    expect(shadow().querySelectorAll('.shimmer')).toHaveLength(0)
  })

  it('stays quiet when Lens is off, paused, or the page has a password field', async () => {
    backend.settings = { ...ENABLED, enabled: false }
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(true)
    backend.push(ENABLED)
    select('standard errors')
    expect(chip().hidden).toBe(false)

    const onPauseChange = vi.fn()
    lens.destroy()
    await start({ onPauseChange })
    select('heteroscedasticity')
    await lens.ask()
    lens.setPaused(true)
    expect(onPauseChange).toHaveBeenCalledWith(true)
    expect(lens.marks()).toHaveLength(0)
    select('standard errors')
    expect(chip().hidden).toBe(true)

    lens.destroy()
    document.body.insertAdjacentHTML('beforeend', '<input type="password">')
    expect(pageBlockReason(document)).toBe('password-field')
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(true)
  })

  it('restores everything when settings turn Lens off', async () => {
    const html = article.innerHTML
    await start()
    select('heteroscedasticity')
    await lens.ask()
    backend.push({ ...ENABLED, enabled: false })
    expect(article.innerHTML).toBe(html)
  })

  it('cancels an in-flight request when the reader moves on', async () => {
    let resolve: (result: RewriteResult) => void = () => undefined
    backend.rewrite = vi.fn(
      (reqId: string) =>
        new Promise<RewriteResult>((done) => {
          backend.requests.push({ reqId, request: {} as RewriteRequest })
          resolve = done
        })
    )
    await start()
    select('heteroscedasticity')
    const pending = lens.ask()
    select('standard errors')
    expect(backend.cancelled).toEqual([backend.requests[0]?.reqId])
    resolve({
      kind: 'rewritten',
      action: 'replace',
      transform: 'define',
      text: 'late',
      term: null,
      confidence: 1,
      cacheKey: 'k'
    })
    expect(await pending).toBeNull()
    expect(lens.marks()).toHaveLength(0)
  })
})
