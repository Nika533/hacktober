import { CopyController } from './clipboard'
import { extractContext, type PageContext } from './context'
import type {
  DomainRisk,
  LensBackend,
  LensEventKind,
  LensSettingsView,
  RewriteRequest
} from './contract'
import { COPY, announceChange } from './copy'
import { wordCount } from './text'
import { DynamicPageDetector } from './render/detect'
import { InlineRenderer } from './render/inline'
import { OverlayRenderer } from './render/overlay'
import type { Mark, MarkSpec, Renderer, RendererEvent } from './render/types'
import { SelectionWatcher, type SelectionCandidate } from './selection'
import { LensUi } from './ui/lens-ui'
import { viewportOf } from './ui/position'
import { createUiRoot, type UiRoot } from './ui/root'

export type RendererChoice = 'auto' | 'inline' | 'overlay'

export interface CreateLensOptions {
  document: Document
  backend: LensBackend
  shadowMode?: ShadowRootMode
  renderer?: RendererChoice
  paused?: boolean
  onPauseChange?: (paused: boolean) => void
  risk?: (context: PageContext) => DomainRisk
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
  setPaused(paused: boolean): void
  destroy(): void
}

interface Applied {
  mark: Mark
  renderer: Renderer
  context: PageContext
  eventId: string
}

const OFF: LensSettingsView = { enabled: false, mode: 'off', copy: 'original', highStakes: 'gloss' }

export function pageBlockReason(doc: Document): 'password-field' | null {
  return doc.querySelector('input[type="password" i]') ? 'password-field' : null
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
  const ids = options.ids ?? defaultIds()
  const now = options.now ?? (() => Date.now())
  const animate = options.animate ?? true
  const shadowMode = options.shadowMode ?? 'closed'
  const root: UiRoot = createUiRoot({ document: doc, shadowMode })
  const detector = new DynamicPageDetector({ document: doc })
  const choice = options.renderer ?? 'auto'
  if (choice === 'auto') detector.start()
  const renderers: { inline?: InlineRenderer; overlay?: OverlayRenderer } = {}
  const applied = new Map<string, Applied>()
  const order: string[] = []
  const cleanup: Array<() => void> = []
  let settings: LensSettingsView = OFF
  let paused = options.paused ?? false
  let candidate: SelectionCandidate | null = null
  let inflight: string | null = null
  let drops = 0
  let destroyed = false

  const remembered = new Map<string, Applied>()
  const report = (error: unknown): void => options.onError?.(error)

  const onRendererEvent = (renderer: Renderer) => (event: RendererEvent) => {
    if (event.type === 'dropped') {
      const entry = applied.get(event.mark.id)
      applied.delete(event.mark.id)
      order.splice(order.indexOf(event.mark.id), 1)
      ui.detach(event.mark.id)
      if (renderer.kind === 'inline' && ++drops >= 2) detector.markDynamic()
      if (entry) remembered.set(event.mark.id, entry)
    } else {
      const previous = remembered.get(event.previousId)
      remembered.delete(event.previousId)
      if (previous) {
        applied.set(event.mark.id, { ...previous, mark: event.mark, renderer })
        order.push(event.mark.id)
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

  const active = (): boolean =>
    !destroyed && !paused && settings.enabled && settings.mode !== 'off' && !pageBlockReason(doc)

  const sync = (): void => ui.setCount(applied.size, paused)

  const feedback = (entry: Applied, kind: LensEventKind, latencyMs = 0): void => {
    try {
      backend.feedback({
        eventId: kind === 'shown' ? entry.eventId : ids(),
        kind,
        transform: entry.mark.spec.transform,
        mode: 'ask',
        term: null,
        lang: entry.context.lang,
        spanWords: wordCount(entry.context.span),
        latencyMs
      })
    } catch (error) {
      report(error)
    }
  }

  const restore = (mark: Mark, kind: LensEventKind): void => {
    const entry = applied.get(mark.id)
    if (!entry) return
    applied.delete(mark.id)
    order.splice(order.indexOf(mark.id), 1)
    ui.detach(mark.id)
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

  const copy = new CopyController({
    document: doc,
    mode: () => settings.copy,
    visibleText: (host) => renderers.inline?.visibleText(host) ?? null
  })

  const setPaused = (next: boolean): void => {
    if (paused === next) return
    paused = next
    if (paused) {
      ui.hideChip()
      restoreAll('reverted')
    }
    options.onPauseChange?.(paused)
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
        backend.explainMore({
          span: mark.original,
          paragraph: entry.context.paragraph,
          title: entry.context.title
        })
        feedback(entry, 'explain_more')
      },
      copyRewritten: (mark) => void copy.writeText(mark.spec.text),
      undoLast: () => {
        const id = order[order.length - 1]
        const entry = id ? applied.get(id) : undefined
        if (entry) restore(entry.mark, 'reverted')
      },
      undoAll: () => {
        restoreAll('reverted')
        ui.announce(COPY.restoredAll)
      },
      togglePause: () => setPaused(!paused),
      ask: () => void ask()
    }
  })

  const watcher = new SelectionWatcher(
    { document: doc, now },
    {
      settled: (next) => {
        if (inflight) backend.cancel(inflight)
        inflight = null
        candidate = null
        ui.hideChip()
        if (!active() || next.signals.sizeClass === 'multi-paragraph') return
        if (!rendererFor().check(next.range).ok) return
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
    const view = viewportOf(doc)
    return rect.bottom > 0 && rect.top < view.height
  }

  async function ask(): Promise<Mark | null> {
    const target = candidate
    candidate = null
    ui.hideChip()
    if (!target || !active()) return null
    const range = target.range
    const context = extractContext(range)
    const risk = options.risk?.(context) ?? 'normal'
    const reqId = ids()
    inflight = reqId
    doc.getSelection()?.removeAllRanges()
    const started = now()
    const thinking = ui.thinking(Array.from(range.getClientRects()), COPY.thinking)
    const request: RewriteRequest = { ...context, risk }
    try {
      const result = await backend.rewrite(reqId, request)
      if (inflight !== reqId || destroyed) return null
      if (result.kind === 'skipped') {
        ui.announce(COPY.skipped)
        return null
      }
      const forceGloss =
        settings.mode === 'gloss' || (risk === 'high' && settings.highStakes === 'gloss')
      const spec: MarkSpec = {
        action: forceGloss ? 'gloss' : result.action,
        transform: result.transform,
        text: result.text,
        highStakes: risk === 'high'
      }
      const renderer = rendererFor()
      const mark = renderer.apply(range, spec, { animate: animate && inView(range) })
      if (!mark) return null
      const entry: Applied = { mark, renderer, context, eventId: ids() }
      applied.set(mark.id, entry)
      order.push(mark.id)
      ui.attach(mark)
      ui.announce(announceChange(spec))
      feedback(entry, 'shown', now() - started)
      sync()
      return mark
    } catch (error) {
      if (inflight === reqId) ui.announce(COPY.unavailable)
      report(error)
      return null
    } finally {
      thinking.done()
      if (inflight === reqId) inflight = null
    }
  }

  const ready = backend.getSettings().then(
    (initial) => {
      settings = initial
    },
    (error: unknown) => report(error)
  )
  cleanup.push(
    backend.onSettings((next) => {
      settings = next
      if (!active()) {
        ui.hideChip()
        if (!next.enabled || next.mode === 'off') restoreAll('reverted')
      }
    })
  )

  return {
    ui,
    ready,
    marks: () => [...applied.values()].map((entry) => entry.mark),
    ask,
    undoLast: () => {
      const id = order[order.length - 1]
      const entry = id ? applied.get(id) : undefined
      if (entry) restore(entry.mark, 'reverted')
    },
    undoAll: () => restoreAll('reverted'),
    setPaused,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      if (inflight) backend.cancel(inflight)
      watcher.destroy()
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
