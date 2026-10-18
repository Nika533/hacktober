import {
  DEFAULT_LENS_SETTINGS,
  confusionScore,
  type LensBackend,
  type LensSettings
} from '@hoot/core'
import { LensContextSchema, LensEventSchema, RewriteRequestSchema } from '@hoot/core/schemas'
import {
  FAKE_PROFILE_SNAPSHOT,
  createFakeLensBackend,
  type FakeLensBackend
} from '@hoot/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLens, isForeignLanguage, pageBlockReason, type Lens } from '../src/controller'
import { UI_TAG } from '../src/guard'
import { loadArticle, rangeForText, textNodes } from './helpers'

const ENABLED: LensSettings = { ...DEFAULT_LENS_SETTINGS, enabled: true, mode: 'ask' }
const SITE = 'example.com'

let article: HTMLElement
let backend: FakeLensBackend
let lens: Lens | null
let now = 1_000

const shadow = (): ShadowRoot => document.documentElement.querySelector(UI_TAG)!.shadowRoot!
const chip = (): HTMLButtonElement => shadow().querySelector('[data-action="ask"]')!
const button = (action: string): HTMLButtonElement =>
  shadow().querySelector(`[data-action="${action}"]`)!

function select(needle: string): void {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(rangeForText(article, needle))
  document.dispatchEvent(new Event('selectionchange'))
  vi.advanceTimersByTime(300)
}

async function ask(): ReturnType<Lens['ask']> {
  const pending = lens!.ask()
  await vi.advanceTimersByTimeAsync(5)
  return pending
}

async function start(
  options: Partial<Parameters<typeof createLens>[0]> = {},
  using: LensBackend = backend
): Promise<void> {
  lens = createLens({
    document,
    backend: using,
    site: SITE,
    urlHash: 'h1',
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
  now = 1_000
  document.documentElement.querySelectorAll(UI_TAG).forEach((node) => node.remove())
  article = loadArticle()
  backend = createFakeLensBackend({ settings: ENABLED })
  lens = null
})

afterEach(() => {
  lens?.destroy()
  vi.useRealTimers()
})

describe('createLens with @hoot/core fakes', () => {
  it('shows the chip on a settled selection and rewrites on ask', async () => {
    const rewrite = vi.spyOn(backend, 'rewrite')
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(false)
    const mark = await ask()
    expect(mark?.anchor.textContent).toBe('heteroscedasticity (a fake definition)')
    const request = rewrite.mock.calls[0]?.[0]
    expect(RewriteRequestSchema.parse(request)).toBeTruthy()
    expect(request?.ctx).toMatchObject({
      span: 'heteroscedasticity',
      headingPath: ['Reading regression output', 'Residuals'],
      title: 'Reading regression output',
      lang: 'en',
      site: SITE,
      siteCategory: 'general',
      surface: 'html'
    })
    expect(request?.ctx.p).toBeCloseTo(confusionScore(request!.ctx.signals))
    expect(request?.ctx.signals).toMatchObject({ sizeClass: 'term', reselectCount: 0 })
    expect(request?.risk).toBe('normal')
    expect(shadow().querySelector('.pill .status')?.textContent).toBe('Hoot changed 1 thing')
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.events.map((event) => event.kind)).toEqual(['shown'])
    const shown = LensEventSchema.parse(backend.events[0])
    expect(shown).toMatchObject({
      site: SITE,
      urlHash: 'h1',
      mode: 'ask',
      transform: 'define',
      term: 'heteroscedasticity',
      spanWords: 1,
      cacheKey: expect.stringMatching(/^[0-9a-f]{16}$/)
    })
  })

  it('reports restore and "I knew this" as feedback and restores exactly', async () => {
    const html = article.innerHTML
    const nodes = textNodes(article)
    await start()
    select('heteroscedasticity')
    const first = await ask()
    lens!.ui.popover.show(first!)
    button('knewIt').click()
    select('standard errors')
    await ask()
    lens!.undoLast()
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.events.map((event) => event.kind)).toEqual([
      'shown',
      'knew_it',
      'shown',
      'reverted'
    ])
    expect(article.innerHTML).toBe(html)
    expect(textNodes(article)).toEqual(nodes)
    expect(lens!.marks()).toHaveLength(0)
  })

  it('passes the full context to Explain more', async () => {
    await start()
    select('heteroscedasticity')
    const mark = await ask()
    lens!.ui.popover.show(mark!)
    button('explainMore').click()
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.explained).toHaveLength(1)
    const ctx = LensContextSchema.parse(backend.explained[0])
    expect(ctx.paragraph).toContain('the model shows heteroscedasticity, and the usual')
    expect(backend.events.at(-1)?.kind).toBe('explain_more')
  })

  it('forces a gloss on high-stakes pages and in gloss-only mode', async () => {
    await start({ classify: () => ({ siteCategory: 'legal', risk: 'high' }) })
    select('heteroscedasticity')
    const mark = await ask()
    expect(mark?.spec).toMatchObject({ action: 'gloss', highStakes: true })
    lens!.destroy()

    article = loadArticle()
    backend = createFakeLensBackend({ settings: { ...ENABLED, mode: 'gloss' } })
    await start()
    select('heteroscedasticity')
    expect((await ask())?.spec.action).toBe('gloss')
  })

  it('does nothing when the backend skips or fails', async () => {
    const skipping: LensBackend = {
      ...backend,
      rewrite: async () => ({ kind: 'skipped', reason: 'model_skip' })
    }
    const errors: unknown[] = []
    await start({ onError: (error) => errors.push(error) }, skipping)
    select('heteroscedasticity')
    expect(await ask()).toBeNull()
    lens!.destroy()

    const failing: LensBackend = {
      ...backend,
      rewrite: async () => {
        throw new Error('bridge down')
      }
    }
    await start({ onError: (error) => errors.push(error) }, failing)
    select('standard errors')
    expect(await ask()).toBeNull()
    expect(errors).toHaveLength(1)
    expect(lens!.marks()).toHaveLength(0)
    expect(shadow().querySelectorAll('.shimmer')).toHaveLength(0)
  })

  it('stays quiet while Lens is off and wakes up when settings change', async () => {
    backend = createFakeLensBackend({ settings: { ...ENABLED, enabled: false } })
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(true)
    backend.emitSettings(ENABLED)
    select('standard errors')
    expect(chip().hidden).toBe(false)
  })

  it('pauses the site through patchSettings and restores the page', async () => {
    const html = article.innerHTML
    await start()
    select('heteroscedasticity')
    await ask()
    await lens!.setPaused(true)
    expect((await backend.getSettings()).sites[SITE]).toBe('paused')
    expect(article.innerHTML).toBe(html)
    select('standard errors')
    expect(chip().hidden).toBe(true)
    await lens!.setPaused(false)
    expect((await backend.getSettings()).sites[SITE]).toBeUndefined()
    select('residuals')
    expect(chip().hidden).toBe(false)
  })

  it('honours a "never" site rule and pages with a password field', async () => {
    backend = createFakeLensBackend({ settings: { ...ENABLED, sites: { [SITE]: 'never' } } })
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(true)
    lens!.destroy()

    backend = createFakeLensBackend({ settings: ENABLED })
    document.body.insertAdjacentHTML('beforeend', '<input type="password">')
    expect(pageBlockReason(document)).toBe('password-field')
    await start()
    select('heteroscedasticity')
    expect(chip().hidden).toBe(true)
  })

  it('stays off on deny-listed hosts unless the site is set to always', async () => {
    await start({ site: 'google.com', hostname: 'mail.google.com' })
    select('heteroscedasticity')
    expect(chip().hidden).toBe(true)
    lens!.destroy()

    backend = createFakeLensBackend({ settings: { ...ENABLED, sites: { 'google.com': 'always' } } })
    await start({ site: 'google.com', hostname: 'mail.google.com' })
    select('heteroscedasticity')
    expect(chip().hidden).toBe(false)
  })

  it('classifies the site with core: high-stakes hosts get glosses, overrides win', async () => {
    const rewrite = vi.spyOn(backend, 'rewrite')
    await start({ site: 'nih.gov', hostname: 'www.nih.gov' })
    select('heteroscedasticity')
    expect((await ask())?.spec.action).toBe('gloss')
    expect(rewrite.mock.calls[0]?.[0]).toMatchObject({
      risk: 'high',
      ctx: { siteCategory: 'medical' }
    })
    lens!.destroy()

    article = loadArticle()
    backend = createFakeLensBackend({
      settings: { ...ENABLED, riskOverrides: { 'nih.gov': 'normal' } }
    })
    await start({ site: 'nih.gov', hostname: 'www.nih.gov' })
    select('heteroscedasticity')
    expect((await ask())?.spec.action).toBe('replace')
  })

  it('restores everything when settings turn Lens off', async () => {
    const html = article.innerHTML
    await start()
    select('heteroscedasticity')
    await ask()
    backend.emitSettings({ ...ENABLED, enabled: false })
    expect(article.innerHTML).toBe(html)
  })

  it('cancels an in-flight request when the reader moves on', async () => {
    backend = createFakeLensBackend({ settings: ENABLED, delayMs: 1000 })
    await start()
    select('heteroscedasticity')
    const pending = lens!.ask()
    select('standard errors')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toBeNull()
    expect(lens!.marks()).toHaveLength(0)
  })

  it('reports "kept" for a change that stayed on screen for 30 s', async () => {
    await start()
    select('heteroscedasticity')
    const mark = await ask()
    vi.spyOn(mark!, 'rects').mockReturnValue([new DOMRect(40, 120, 160, 24)])
    vi.advanceTimersByTime(29_000)
    expect(backend.events.map((event) => event.kind)).toEqual(['shown'])
    vi.advanceTimersByTime(1_000)
    expect(backend.events.map((event) => event.kind)).toEqual(['shown', 'kept'])
    expect(LensEventSchema.parse(backend.events[1])).toMatchObject({
      kind: 'kept',
      term: 'heteroscedasticity',
      transform: 'define'
    })
  })

  it('reports "copied_original" once when a copy gives the reader the original', async () => {
    await start()
    select('heteroscedasticity')
    await ask()
    const copy = (): void => {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('hoot-lens-mark')!.parentElement!)
      const selection = document.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.body.dispatchEvent(
        new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData: new DataTransfer()
        })
      )
    }
    copy()
    copy()
    expect(backend.events.map((event) => event.kind)).toEqual(['shown', 'copied_original'])
    expect(LensEventSchema.parse(backend.events[1]).term).toBe('heteroscedasticity')
  })

  it('does not report "copied_original" when copies give what the reader sees', async () => {
    backend = createFakeLensBackend({ settings: { ...ENABLED, copyBehavior: 'visible' } })
    await start()
    select('heteroscedasticity')
    const mark = await ask()
    const data = new DataTransfer()
    document.getSelection()!.removeAllRanges()
    mark!.anchor.dispatchEvent(
      new ClipboardEvent('copy', {
        bubbles: true,
        composed: true,
        cancelable: true,
        clipboardData: data
      })
    )
    expect(data.getData('text/plain')).toBe('heteroscedasticity (a fake definition)')
    expect(backend.events.map((event) => event.kind)).toEqual(['shown'])
  })

  it('sends the rarity of acronyms and notation with the context (s6)', async () => {
    const rewrite = vi.spyOn(backend, 'rewrite')
    await start()
    select('OLS')
    await ask()
    expect(rewrite.mock.calls[0]?.[0].ctx.signals).toMatchObject({ rarity: 0.8, reread: 0 })
  })

  it('reports "reselected" when the reader selects a changed term again', async () => {
    await start()
    select('heteroscedasticity')
    await ask()
    lens!.undoLast()
    select('heteroscedasticity')
    select('standard errors')
    select('heteroscedasticity')
    expect(backend.events.map((event) => event.kind)).toEqual(['shown', 'reverted', 'reselected'])
    expect(LensEventSchema.parse(backend.events[2]).term).toBe('heteroscedasticity')
  })

  it('never reports "kept" for a change restored within 30 s', async () => {
    await start()
    select('heteroscedasticity')
    const mark = await ask()
    vi.spyOn(mark!, 'rects').mockReturnValue([new DOMRect(40, 120, 160, 24)])
    vi.advanceTimersByTime(10_000)
    lens!.undoLast()
    vi.advanceTimersByTime(60_000)
    expect(backend.events.map((event) => event.kind)).toEqual(['shown', 'reverted'])
  })
})

describe('Auto and Gloss-only modes (decide)', () => {
  const AUTO: LensSettings = { ...ENABLED, mode: 'auto' }
  const kinds = (): string[] => backend.events.map((event) => event.kind)

  async function dwell(): Promise<void> {
    now += 1500
    vi.advanceTimersByTime(1200)
    await vi.advanceTimersByTimeAsync(5)
  }

  function reselect(needle: string): void {
    select(needle)
    select('standard errors')
    select(needle)
  }

  it('asks the model in the gray zone and rewrites when it says the text is hard', async () => {
    backend = createFakeLensBackend({ settings: AUTO })
    const assess = vi.spyOn(backend, 'assess')
    await start()
    select('OLS')
    expect(chip().hidden).toBe(true)
    await dwell()
    expect(assess).toHaveBeenCalledOnce()
    expect(lens!.marks()[0]?.anchor.textContent).toBe('OLS (Fake Expanded Form)')
    const shown = LensEventSchema.parse(backend.events[0])
    expect(shown).toMatchObject({ kind: 'shown', mode: 'replace', difficulty: 0.8 })
    expect(shown.p).toBeGreaterThanOrEqual(0.6)
    expect(shown.p).toBeLessThan(0.75)
  })

  it('rewrites without asking the model above the threshold', async () => {
    backend = createFakeLensBackend({ settings: AUTO })
    const assess = vi.spyOn(backend, 'assess')
    await start()
    reselect('OLS')
    await dwell()
    expect(assess).not.toHaveBeenCalled()
    expect(lens!.marks()).toHaveLength(1)
    expect(LensEventSchema.parse(backend.events[0]).p).toBeGreaterThanOrEqual(0.75)
  })

  it('leaves ordinary selections alone and sends nothing', async () => {
    backend = createFakeLensBackend({ settings: AUTO })
    const assess = vi.spyOn(backend, 'assess')
    const rewrite = vi.spyOn(backend, 'rewrite')
    await start()
    select('heteroscedasticity')
    await dwell()
    expect(chip().hidden).toBe(true)
    expect(assess).not.toHaveBeenCalled()
    expect(rewrite).not.toHaveBeenCalled()
  })

  it('offers the chip instead during the cold start', async () => {
    backend = createFakeLensBackend({
      settings: AUTO,
      profile: { ...FAKE_PROFILE_SNAPSHOT, askFirstRemaining: 10 }
    })
    const rewrite = vi.spyOn(backend, 'rewrite')
    await start()
    reselect('OLS')
    expect(chip().hidden).toBe(false)
    await dwell()
    expect(rewrite).not.toHaveBeenCalled()
    chip().click()
    await vi.advanceTimersByTimeAsync(5)
    expect(LensEventSchema.parse(backend.events[0]).mode).toBe('ask')
  })

  it('switches the page to asking after two reverted changes in a row', async () => {
    backend = createFakeLensBackend({ settings: AUTO })
    await start()
    reselect('OLS')
    await dwell()
    lens!.undoLast()
    reselect('HC3')
    await dwell()
    lens!.undoLast()
    expect(kinds()).toEqual(['shown', 'reverted', 'shown', 'reverted'])
    reselect('OLS')
    expect(chip().hidden).toBe(false)
    await dwell()
    expect(lens!.marks()).toHaveLength(0)
  })

  it('does nothing when the reader copies or deselects first', async () => {
    backend = createFakeLensBackend({ settings: AUTO, delayMs: 1000 })
    const rewrite = vi.spyOn(backend, 'rewrite')
    await start()
    reselect('OLS')
    document.dispatchEvent(new Event('copy'))
    await dwell()
    expect(rewrite).not.toHaveBeenCalled()

    reselect('HC3')
    await dwell()
    expect(rewrite).toHaveBeenCalledOnce()
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(lens!.marks()).toHaveLength(0)
    expect(kinds()).toEqual([])
  })

  it('glosses in Gloss-only mode', async () => {
    backend = createFakeLensBackend({ settings: { ...AUTO, mode: 'gloss' } })
    await start()
    reselect('OLS')
    await dwell()
    expect(lens!.marks()[0]?.spec.action).toBe('gloss')
    expect(LensEventSchema.parse(backend.events[0]).mode).toBe('gloss')
  })
})

describe('isForeignLanguage', () => {
  const languages = { primary: 'en', comfortable: ['fr-CA'] }

  it.each([
    ['en-GB', false],
    ['fr', false],
    ['de', true],
    ['und', false],
    ['', false]
  ])('%s → %s', (lang, expected) => {
    expect(isForeignLanguage(lang, languages)).toBe(expected)
  })
})
