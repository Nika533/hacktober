import {
  COLD_START_ASK_FIRST,
  COLD_START_THRESHOLD,
  GRAY_ZONE_MIN_DIFFICULTY,
  PageRateLimiter,
  TRANSFORMS,
  classifySite,
  confusionScore,
  countWords,
  decide,
  isDeniedHost,
  type DomainRisk,
  type LensBackend,
  type LensContext,
  type LensDecision,
  type LensEvent,
  type LensEventKind,
  type LensSettings,
  type LensSurface,
  type ProfileSnapshot,
  type SiteCategory
} from '@hoot/core'
import { CopyController } from './clipboard'
import { extractContext, type PageContext } from './context'
import { COPY, announceChange } from './copy'
import { KeptTracker } from './kept'
import { DynamicPageDetector } from './render/detect'
import { InlineRenderer } from './render/inline'
import { OverlayRenderer } from './render/overlay'
import type { Mark, MarkSpec, Renderer, RendererEvent } from './render/types'
import { SelectionWatcher, type SelectionCandidate } from './selection'
import { ReadingTracker, rarityOf } from './signals'
import { normalizeWhitespace } from './text'
import { LensUi } from './ui/lens-ui'
import { viewportOf } from './ui/position'
import { createUiRoot, type UiRoot } from './ui/root'

export type RendererChoice = 'auto' | 'inline' | 'overlay'

export interface PageClassification {
  siteCategory: SiteCategory
  risk: DomainRisk
}

export interface CreateLensOptions {
  document: Document
  backend: LensBackend
  site: string
  /** Full hostname for the deny list and risk classification; defaults to `site`. */
  hostname?: string
  urlHash?: string
  surface?: LensSurface
  shadowMode?: ShadowRootMode
  /** A built-in renderer, or the host's own (e.g. pdf-view's `PdfOverlayRenderer`). */
  renderer?: RendererChoice | Renderer
  classify?: (context: PageContext) => PageClassification
  ids?: () => string
  now?: () => number
  animate?: boolean
  trustedOnly?: boolean
  onError?: (error: unknown) => void
}

export interface Lens {
  readonly ui: LensUi
  readonly ready: Promise<void>
  marks(): Mark[]
  ask(): Promise<Mark | null>
  undoLast(): void
  undoAll(): void
  setPaused(paused: boolean): Promise<void>
  destroy(): void
}

interface Applied {
  mark: Mark
  renderer: Renderer
  ctx: LensContext
  term: string | null
  mode: LensEvent['mode']
  difficulty: number | null
  cacheKey: string
}

type Origin = 'ask' | 'auto'

/** Until the app sends the reader's profile: cautious threshold and Ask-first (§8.4). */
const COLD_PROFILE: ProfileSnapshot = {
  version: 0,
  threshold: COLD_START_THRESHOLD,
  askFirstRemaining: COLD_START_ASK_FIRST,
  knownTerms: [],
  perSite: {}
}

export function pageBlockReason(doc: Document): 'password-field' | null {
  return doc.querySelector('input[type="password" i]') ? 'password-field' : null
}

const primaryTag = (tag: string): string => tag.trim().toLowerCase().split('-')[0] ?? ''

export function isForeignLanguage(lang: string, languages: LensSettings['languages']): boolean {
  const code = primaryTag(lang)
  if (!code || code === 'und') return false
  if (code === primaryTag(languages.primary)) return false
  return !languages.comfortable.some((tag) => primaryTag(tag) === code)
}

function defaultIds(): () => string {
  let seq = 0
  const salt = Array.from(globalThis.crypto?.getRandomValues?.(new Uint32Array(2)) ?? [Date.now()])
    .map((part) => part.toString(36))
    .join('')
  return () => `${salt}-${(++seq).toString(36)}`
}

export function createLens(options: CreateLensOptions): Lens {
  const doc = options.document
  const backend = options.backend
  const site = options.site
  const hostname = options.hostname ?? site
  const denied = isDeniedHost(hostname)
  const urlHash = options.urlHash ?? ''
  const surface = options.surface ?? 'html'
  const ids = options.ids ?? defaultIds()
  const now = options.now ?? (() => Date.now())
  const classify =
    options.classify ??
    ((page: PageContext): PageClassification => {
      const { category, risk } = classifySite({
        hostname,
        title: page.title,
        headings: page.headingPath,
        overrides: settings?.riskOverrides
      })
      return { siteCategory: category, risk }
    })
  const animate = options.animate ?? true
  const shadowMode = options.shadowMode ?? 'closed'
  const root: UiRoot = createUiRoot({ document: doc, shadowMode })
  const detector = new DynamicPageDetector({ document: doc })
  const choice = options.renderer ?? 'auto'
  if (choice === 'auto') detector.start()
  const renderers: { inline?: InlineRenderer; overlay?: OverlayRenderer } = {}
  const applied = new Map<string, Applied>()
  const remembered = new Map<string, Applied>()
  const order: string[] = []
  const cleanup: Array<() => void> = []
  let settings: LensSettings | null = null
  let profile: ProfileSnapshot = COLD_PROFILE
  let knownTerms = new Set<string>()
  let candidate: SelectionCandidate | null = null
  let inflight: { controller: AbortController; origin: Origin } | null = null
  const limiter = new PageRateLimiter()
  let drops = 0
  let destroyed = false

  const report = (error: unknown): void => options.onError?.(error)
  const rule = (): string | undefined => settings?.sites[site]
  const paused = (): boolean => rule() === 'paused'
  const active = (): boolean =>
    !destroyed &&
    !!settings?.enabled &&
    !paused() &&
    rule() !== 'never' &&
    (rule() === 'always' || !denied) &&
    !pageBlockReason(doc)

  const sync = (): void => ui.setCount(applied.size, paused())

  const forget = (id: string): void => {
    applied.delete(id)
    const index = order.indexOf(id)
    if (index >= 0) order.splice(index, 1)
    ui.detach(id)
  }

  const onRendererEvent = (renderer: Renderer) => (event: RendererEvent) => {
    if (event.type === 'dropped') {
      const entry = applied.get(event.mark.id)
      forget(event.mark.id)
      if (renderer.kind === 'inline' && ++drops >= 2) detector.markDynamic()
      if (entry) remembered.set(event.mark.id, entry)
    } else {
      const previous = remembered.get(event.previousId)
      remembered.delete(event.previousId)
      if (previous) {
        applied.set(event.mark.id, { ...previous, mark: event.mark, renderer })
        order.push(event.mark.id)
        kept.replace(event.previousId, event.mark)
      }
      ui.attach(event.mark)
    }
    sync()
  }

  const inline = (): InlineRenderer => {
    if (!renderers.inline) {
      renderers.inline = new InlineRenderer({ document: doc, shadowMode })
      cleanup.push(renderers.inline.subscribe(onRendererEvent(renderers.inline)))
    }
    return renderers.inline
  }

  const overlay = (): OverlayRenderer => {
    if (!renderers.overlay) {
      renderers.overlay = new OverlayRenderer({ document: doc, root })
      cleanup.push(renderers.overlay.subscribe(onRendererEvent(renderers.overlay)))
    }
    return renderers.overlay
  }

  const host = typeof choice === 'object' ? choice : null
  if (host) cleanup.push(host.subscribe(onRendererEvent(host)))

  const rendererFor = (): Renderer => {
    if (host) return host
    if (choice === 'inline') return inline()
    if (choice === 'overlay') return overlay()
    return detector.dynamic ? overlay() : inline()
  }

  const feedback = (entry: Applied, kind: LensEventKind, latencyMs = 0): void => {
    void backend
      .feedback({
        id: ids(),
        ts: now(),
        site,
        urlHash,
        kind,
        transform: entry.mark.spec.transform,
        mode: entry.mode,
        term: entry.term,
        topic: (entry.ctx.headingPath[0] ?? entry.ctx.title).slice(0, 200) || null,
        lang: entry.ctx.lang,
        spanWords: countWords(entry.ctx.span),
        p: entry.ctx.p,
        difficulty: entry.difficulty,
        latencyMs,
        cacheKey: entry.cacheKey
      })
      .catch(report)
  }

  const kept = new KeptTracker({
    document: doc,
    onKept: (id) => {
      const entry = applied.get(id)
      if (!entry) return
      if (entry.mode !== 'ask') limiter.recordKept()
      feedback(entry, 'kept')
    }
  })

  const restore = (mark: Mark, kind: LensEventKind): void => {
    const entry = applied.get(mark.id)
    if (!entry) return
    forget(mark.id)
    kept.forget(mark.id)
    if (entry.mode !== 'ask' && (kind === 'reverted' || kind === 'knew_it')) {
      limiter.recordRevert()
    }
    entry.renderer.restore(mark.id, { animate })
    feedback(entry, kind)
    ui.announce(COPY.restored)
    sync()
  }

  const restoreAll = (kind: LensEventKind): void => {
    for (const id of [...order].reverse()) {
      const entry = applied.get(id)
      if (entry) restore(entry.mark, kind)
    }
  }

  const undoLast = (): void => {
    const id = order[order.length - 1]
    const entry = id ? applied.get(id) : undefined
    if (entry) restore(entry.mark, 'reverted')
  }

  const copiedOriginal = new Set<string>()
  const copy = new CopyController({
    document: doc,
    mode: () => settings?.copyBehavior ?? 'original',
    visibleText: (host) => renderers.inline?.visibleText(host) ?? null,
    copiedOriginal: (hosts) => {
      for (const host of hosts) {
        const id = (host as HTMLElement).dataset.hootLens ?? ''
        const entry = applied.get(id)
        if (!entry || copiedOriginal.has(id)) continue
        copiedOriginal.add(id)
        feedback(entry, 'copied_original')
      }
    }
  })

  const shown = new Map<string, Applied>()
  const reselected = new WeakSet<Applied>()
  const termKey = (text: string): string => normalizeWhitespace(text).toLowerCase()

  const noteReselection = (text: string): void => {
    const entry = shown.get(termKey(text))
    if (!entry || reselected.has(entry)) return
    reselected.add(entry)
    feedback(entry, 'reselected')
  }

  const setPaused = async (next: boolean): Promise<void> => {
    if (!settings || paused() === next) return
    if (next) {
      ui.hideChip()
      restoreAll('reverted')
    }
    const sites = { ...settings.sites }
    if (next) sites[site] = 'paused'
    else delete sites[site]
    settings = { ...settings, sites }
    sync()
    try {
      settings = await backend.patchSettings({ sites: { [site]: next ? 'paused' : null } })
    } catch (error) {
      report(error)
    }
    sync()
  }

  const ui = new LensUi({
    root,
    animate,
    trustedOnly: options.trustedOnly ?? true,
    localFiles: site === '',
    handlers: {
      restore: (mark) => restore(mark, 'reverted'),
      knewIt: (mark) => restore(mark, 'knew_it'),
      explainMore: (mark) => {
        const entry = applied.get(mark.id)
        if (!entry) return
        void backend.explainMore(entry.ctx).catch(report)
        feedback(entry, 'explain_more')
      },
      copyRewritten: (mark) => void copy.writeText(mark.spec.text),
      undoLast,
      undoAll: () => {
        restoreAll('reverted')
        ui.announce(COPY.restoredAll)
      },
      togglePause: () => void setPaused(!paused()),
      ask: () => void ask()
    }
  })

  const showChip = (target: SelectionCandidate): void => {
    const rects = Array.from(target.range.getClientRects())
    ui.showChip(rects[rects.length - 1] ?? target.range.getBoundingClientRect())
  }

  const cancel = (origin?: Origin): void => {
    if (!inflight || (origin && inflight.origin !== origin)) return
    inflight.controller.abort()
    inflight = null
  }

  const reading = new ReadingTracker(doc)
  const watcher = new SelectionWatcher(
    { document: doc, now },
    {
      settled: (next) => {
        cancel()
        candidate = null
        ui.hideChip()
        if (!active() || !settings || next.signals.sizeClass === 'multi-paragraph') return
        const check = rendererFor().check(next.range)
        if (check.ok || check.reason !== 'marked') noteReselection(next.text)
        if (!check.ok) return
        candidate = next
        if (settings.mode === 'ask' || judge(next, settings).decision.action === 'ask') {
          showChip(next)
        }
      },
      dwell: (next) => {
        const current = settings
        if (next !== candidate || !current || current.mode === 'ask' || !active()) return
        const { decision, ctx, risk } = judge(next, current)
        if (decision.action === 'ask') showChip(next)
        else if (decision.action === 'rewrite') void rewrite(next, current, ctx, risk, 'auto')
        else if (decision.action === 'assess') void assessThenRewrite(next, current, ctx, risk)
      },
      cleared: () => {
        cancel('auto')
        candidate = null
        ui.hideChip()
      },
      copied: () => {
        cancel('auto')
        candidate = null
        ui.hideChip()
      }
    }
  )

  const inView = (range: Range): boolean => {
    const rect = range.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < viewportOf(doc).height
  }

  const contextFor = (
    target: SelectionCandidate,
    current: LensSettings
  ): { ctx: LensContext; risk: DomainRisk } => {
    const page = extractContext(target.range)
    const { siteCategory, risk } = classify(page)
    const signals: LensContext['signals'] = {
      sizeClass: target.signals.sizeClass,
      copiedWithinMs: target.signals.copiedWithinMs,
      dwellMs: target.signals.dwellMs,
      reselectCount: target.signals.reselectCount,
      reread: reading.reread(target.range),
      rarity: rarityOf(page.span, page.lang, page.paragraph),
      knownTerm: knownTerms.has(page.span.toLowerCase()),
      topicFamiliarity: null,
      foreignLanguage: isForeignLanguage(page.lang, current.languages),
      blocked: null
    }
    const ctx: LensContext = {
      ...page,
      site,
      siteCategory,
      surface,
      signals,
      p: confusionScore(signals)
    }
    return { ctx, risk }
  }

  const judge = (
    target: SelectionCandidate,
    current: LensSettings
  ): { decision: LensDecision; ctx: LensContext; risk: DomainRisk } => {
    const { ctx, risk } = contextFor(target, current)
    const decision = decide({
      signals: ctx.signals,
      site,
      lens: current,
      profile,
      page: limiter,
      now: now()
    })
    return { decision, ctx, risk }
  }

  const begin = (origin: Origin): AbortController => {
    cancel()
    const controller = new AbortController()
    inflight = { controller, origin }
    return controller
  }

  const settle = (controller: AbortController): void => {
    if (inflight?.controller === controller) inflight = null
  }

  async function rewrite(
    target: SelectionCandidate,
    current: LensSettings,
    ctx: LensContext,
    risk: DomainRisk,
    origin: Origin,
    difficulty: number | null = null,
    controller = begin(origin)
  ): Promise<Mark | null> {
    const range = target.range
    if (origin === 'ask') doc.getSelection()?.removeAllRanges()
    const started = now()
    const thinking = ui.thinking(Array.from(range.getClientRects()), COPY.thinking)
    try {
      const outcome = await backend.rewrite(
        { ctx, allowedTransforms: [...TRANSFORMS], risk },
        { signal: controller.signal }
      )
      if (inflight?.controller !== controller || destroyed || !active()) return null
      if (outcome.kind === 'skipped') {
        if (origin === 'ask' && outcome.reason !== 'cancelled' && outcome.reason !== 'lens_off') {
          ui.announce(COPY.skipped)
        }
        return null
      }
      const { result } = outcome
      const forceGloss =
        current.mode === 'gloss' || (risk === 'high' && current.highStakes === 'gloss')
      const spec: MarkSpec = {
        action: forceGloss ? 'gloss' : result.action,
        transform: result.transform,
        text: result.text,
        highStakes: risk === 'high'
      }
      if (origin === 'auto') doc.getSelection()?.removeAllRanges()
      const renderer = rendererFor()
      const mark = renderer.apply(range, spec, { animate: animate && inView(range) })
      if (!mark) return null
      const entry: Applied = {
        mark,
        renderer,
        ctx,
        term: result.term,
        mode: origin === 'ask' ? 'ask' : spec.action,
        difficulty,
        cacheKey: result.cacheKey
      }
      applied.set(mark.id, entry)
      order.push(mark.id)
      if (origin === 'auto') limiter.recordChange(now())
      ui.attach(mark)
      ui.announce(announceChange(spec))
      feedback(entry, 'shown', now() - started)
      kept.track(mark)
      for (const text of [result.term, ctx.span]) if (text) shown.set(termKey(text), entry)
      sync()
      return mark
    } catch (error) {
      if (origin === 'ask' && inflight?.controller === controller && !controller.signal.aborted) {
        ui.announce(COPY.unavailable)
      }
      report(error)
      return null
    } finally {
      thinking.done()
      settle(controller)
    }
  }

  async function assessThenRewrite(
    target: SelectionCandidate,
    current: LensSettings,
    ctx: LensContext,
    risk: DomainRisk
  ): Promise<void> {
    const controller = begin('auto')
    try {
      const { difficulty } = await backend.assess(ctx, { signal: controller.signal })
      if (inflight?.controller !== controller || difficulty < GRAY_ZONE_MIN_DIFFICULTY) {
        settle(controller)
        return
      }
      await rewrite(target, current, ctx, risk, 'auto', difficulty, controller)
    } catch (error) {
      settle(controller)
      report(error)
    }
  }

  async function ask(): Promise<Mark | null> {
    const target = candidate
    const current = settings
    candidate = null
    ui.hideChip()
    if (!target || !current || !active()) return null
    const { ctx, risk } = contextFor(target, current)
    return rewrite(target, current, ctx, risk, 'ask')
  }

  function useProfile(next: ProfileSnapshot): void {
    profile = next
    knownTerms = new Set(next.knownTerms.map((term) => term.toLowerCase()))
  }

  const ready = Promise.all([
    backend.getSettings().then((initial) => {
      settings = initial
      sync()
    }, report),
    backend.getProfile().then(useProfile, report)
  ]).then(() => undefined)

  cleanup.push(
    backend.onSettings((next) => {
      settings = next
      if (!active()) {
        ui.hideChip()
        restoreAll('reverted')
      }
      sync()
    }),
    backend.onProfile(useProfile)
  )

  return {
    ui,
    ready,
    marks: () => [...applied.values()].map((entry) => entry.mark),
    ask,
    undoLast,
    undoAll: () => restoreAll('reverted'),
    setPaused,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      cancel()
      watcher.destroy()
      reading.destroy()
      kept.destroy()
      detector.stop()
      for (const undo of cleanup.splice(0)) undo()
      renderers.inline?.destroy()
      renderers.overlay?.destroy()
      copy.destroy()
      ui.destroy()
      root.destroy()
    }
  }
}
