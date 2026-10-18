import {
  TRANSFORMS,
  countWords,
  type DomainRisk,
  type LensBackend,
  type LensContext,
  type LensEventKind,
  type LensSettings,
  type LensSurface,
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
  urlHash?: string
  surface?: LensSurface
  shadowMode?: ShadowRootMode
  renderer?: RendererChoice
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
}

const NORMAL_PAGE: PageClassification = { siteCategory: 'general', risk: 'normal' }

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
  const urlHash = options.urlHash ?? ''
  const surface = options.surface ?? 'html'
  const ids = options.ids ?? defaultIds()
  const now = options.now ?? (() => Date.now())
  const classify = options.classify ?? (() => NORMAL_PAGE)
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
  let knownTerms = new Set<string>()
  let candidate: SelectionCandidate | null = null
  let inflight: AbortController | null = null
  let drops = 0
  let destroyed = false

  const report = (error: unknown): void => options.onError?.(error)
  const rule = (): string | undefined => settings?.sites[site]
  const paused = (): boolean => rule() === 'paused'
  const active = (): boolean =>
    !destroyed && !!settings?.enabled && !paused() && rule() !== 'never' && !pageBlockReason(doc)

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

  const rendererFor = (): Renderer => {
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
        mode: 'ask',
        term: entry.term,
        topic: null,
        lang: entry.ctx.lang,
        spanWords: countWords(entry.ctx.span),
        p: entry.ctx.p,
        difficulty: null,
        latencyMs
      })
      .catch(report)
  }

  const kept = new KeptTracker({
    document: doc,
    onKept: (id) => {
      const entry = applied.get(id)
      if (entry) feedback(entry, 'kept')
    }
  })

  const restore = (mark: Mark, kind: LensEventKind): void => {
    const entry = applied.get(mark.id)
    if (!entry) return
    forget(mark.id)
    kept.forget(mark.id)
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

  const reading = new ReadingTracker(doc)
  const watcher = new SelectionWatcher(
    { document: doc, now },
    {
      settled: (next) => {
        inflight?.abort()
        inflight = null
        candidate = null
        ui.hideChip()
        if (!active() || next.signals.sizeClass === 'multi-paragraph') return
        const check = rendererFor().check(next.range)
        if (check.ok || check.reason !== 'marked') noteReselection(next.text)
        if (!check.ok) return
        candidate = next
        const rects = Array.from(next.range.getClientRects())
        ui.showChip(rects[rects.length - 1] ?? next.range.getBoundingClientRect())
      },
      cleared: () => {
        candidate = null
        ui.hideChip()
      },
      copied: () => {
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
    const ctx: LensContext = {
      ...page,
      site,
      siteCategory,
      surface,
      signals: {
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
      },
      p: 0
    }
    return { ctx, risk }
  }

  async function ask(): Promise<Mark | null> {
    const target = candidate
    const current = settings
    candidate = null
    ui.hideChip()
    if (!target || !current || !active()) return null
    const range = target.range
    const { ctx, risk } = contextFor(target, current)
    const controller = new AbortController()
    inflight?.abort()
    inflight = controller
    doc.getSelection()?.removeAllRanges()
    const started = now()
    const thinking = ui.thinking(Array.from(range.getClientRects()), COPY.thinking)
    try {
      const outcome = await backend.rewrite(
        { ctx, allowedTransforms: [...TRANSFORMS], risk },
        { signal: controller.signal }
      )
      if (inflight !== controller || destroyed) return null
      if (outcome.kind === 'skipped') {
        if (outcome.reason !== 'cancelled' && outcome.reason !== 'lens_off') {
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
      const renderer = rendererFor()
      const mark = renderer.apply(range, spec, { animate: animate && inView(range) })
      if (!mark) return null
      const entry: Applied = { mark, renderer, ctx, term: result.term }
      applied.set(mark.id, entry)
      order.push(mark.id)
      ui.attach(mark)
      ui.announce(announceChange(spec))
      feedback(entry, 'shown', now() - started)
      kept.track(mark)
      for (const text of [result.term, ctx.span]) if (text) shown.set(termKey(text), entry)
      sync()
      return mark
    } catch (error) {
      if (inflight === controller && !controller.signal.aborted) ui.announce(COPY.unavailable)
      report(error)
      return null
    } finally {
      thinking.done()
      if (inflight === controller) inflight = null
    }
  }

  const ready = Promise.all([
    backend.getSettings().then((initial) => {
      settings = initial
      sync()
    }),
    backend.getProfile().then((profile) => {
      knownTerms = new Set(profile.knownTerms.map((term) => term.toLowerCase()))
    })
  ]).then(
    () => undefined,
    (error: unknown) => report(error)
  )

  cleanup.push(
    backend.onSettings((next) => {
      settings = next
      if (!active()) {
        ui.hideChip()
        restoreAll('reverted')
      }
      sync()
    }),
    backend.onProfile((profile) => {
      knownTerms = new Set(profile.knownTerms.map((term) => term.toLowerCase()))
    })
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
      inflight?.abort()
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
