import { blockOf } from '../blocks'
import { describeMark } from '../copy'
import { el, isElement, prefersReducedMotion } from '../dom'
import { checkRange } from '../guard'
import { stripWrappingParens } from '../text'
import { DURATION, dematerialize, easing, materialize, play, settled } from '../ui/motion'
import { viewportOf } from '../ui/position'
import type { UiRoot } from '../ui/root'
import { HIGHLIGHT_CSS, HIGHLIGHT_GLOSS, HIGHLIGHT_REPLACE } from '../ui/styles'
import { Lifecycle, blockTextOf, locate, remember, type Remembered } from './lifecycle'
import type {
  ApplyOptions,
  Mark,
  MarkSpec,
  RangeCheck,
  Renderer,
  RendererListener,
  RestoreOptions
} from './types'

export const OVERLAY_CSS = `
.ov-box {
  position: absolute;
  box-sizing: border-box;
  margin: 0;
  pointer-events: none;
  white-space: normal;
  overflow-wrap: break-word;
}
.ov-box mark {
  all: unset;
  pointer-events: auto;
  background:
    linear-gradient(var(--hl-tint), var(--hl-tint)),
    var(--hl-page-bg, var(--hl-surface-solid));
  text-decoration: underline dotted var(--hl-underline);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.2em;
  border-radius: 3px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.ov-box mark:focus-visible {
  outline: 2px solid var(--hl-accent);
  outline-offset: 1px;
}
.ov-box.card {
  width: max-content;
  pointer-events: auto;
  padding: 0 3px;
  margin-inline-start: -3px;
  background: var(--hl-page-bg, var(--hl-surface-solid));
  border-radius: 4px;
  box-shadow:
    var(--hl-shadow-sm),
    0 0 0 1px var(--hl-hairline);
}
.ov-box[data-action='gloss'] {
  width: max-content;
  padding: 4px 10px;
  pointer-events: auto;
  background: var(--hl-surface-solid);
  border: 1px solid var(--hl-hairline);
  border-radius: 8px;
  box-shadow: var(--hl-shadow);
  font: 13px/1.45 var(--hl-font);
  color: var(--hl-text);
}
.ov-box[data-action='gloss'] mark {
  background: none;
  text-decoration: none;
}
@media (prefers-contrast: more) {
  .ov-box mark {
    background: var(--hl-page-bg, var(--hl-surface-solid));
    box-shadow: inset 0 0 0 1px var(--hl-accent);
  }
}
@media (forced-colors: active) {
  .ov-box mark {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
`

interface HighlightPair {
  replace: Highlight
  gloss: Highlight
}

interface Entry {
  mark: OverlayMark
  range: Range
  box: HTMLElement
  block: Element | null
  blockText: string
  reapplies: number
}

class OverlayMark implements Mark {
  constructor(
    readonly id: string,
    readonly spec: MarkSpec,
    readonly original: string,
    readonly anchor: HTMLElement
  ) {}

  rects(): DOMRect[] {
    return Array.from(this.anchor.getClientRects())
  }
}

export interface OverlayRendererOptions {
  document: Document
  root: UiRoot
  reapplyDelayMs?: number
  rects?: (range: Range) => DOMRect[]
}

const FONT_SCALES = [0.94, 0.88, 0.82]
const CARD_MIN_WIDTH = 240

const TEXT_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'color',
  'direction'
] as const

export class OverlayRenderer implements Renderer {
  readonly kind = 'overlay'
  readonly #doc: Document
  readonly #root: UiRoot
  readonly #rects: (range: Range) => DOMRect[]
  readonly #entries = new Map<string, Entry>()
  readonly #lifecycle: Lifecycle
  readonly #cleanup: Array<() => void> = []
  #highlights: HighlightPair | null | undefined
  #resizeObserver: ResizeObserver | null = null
  #frame = 0
  #listening = false
  #seq = 0

  constructor(options: OverlayRendererOptions) {
    this.#doc = options.document
    this.#root = options.root
    this.#rects = options.rects ?? ((range) => Array.from(range.getClientRects()))
    this.#root.styles.apply(this.#root.shadow, OVERLAY_CSS)
    this.#lifecycle = new Lifecycle({
      document: this.#doc,
      delayMs: options.reapplyDelayMs ?? 100,
      active: () => this.#entries.size > 0,
      check: () => this.#checkIntact(),
      reapply: (item) => this.#reapply(item)
    })
  }

  check(range: Range, spec?: MarkSpec): RangeCheck {
    return checkRange(range, spec?.action)
  }

  apply(range: Range, spec: MarkSpec, options: ApplyOptions = {}): Mark | null {
    const entry = this.#apply(range, spec, 0)
    if (entry && options.animate) {
      const isReduced = prefersReducedMotion(this.#doc)
      play(entry.box, materialize(isReduced), {
        duration: isReduced ? DURATION.reducedFade : DURATION.swapHalf * 2,
        easing: easing(this.#doc)
      })
    }
    return entry?.mark ?? null
  }

  restore(id: string, options: RestoreOptions = {}): boolean {
    const entry = this.#entries.get(id)
    if (!entry) return false
    this.#forget(entry)
    if (options.animate) {
      const isReduced = prefersReducedMotion(this.#doc)
      const out = play(entry.box, dematerialize(isReduced), {
        duration: isReduced ? DURATION.reducedFade : DURATION.swapHalf * 2,
        easing: easing(this.#doc),
        fill: 'forwards'
      })
      void settled(out).then(() => this.#teardown(entry))
    } else this.#teardown(entry)
    this.#lifecycle.sync()
    return true
  }

  restoreAll(options: RestoreOptions = {}): number {
    const ids = [...this.#entries.keys()].reverse()
    for (const id of ids) this.restore(id, options)
    return ids.length
  }

  get(id: string): Mark | undefined {
    return this.#entries.get(id)?.mark
  }

  marks(): Mark[] {
    return [...this.#entries.values()].map((entry) => entry.mark)
  }

  subscribe(listener: RendererListener): () => void {
    return this.#lifecycle.subscribe(listener)
  }

  layout(): void {
    for (const entry of this.#entries.values()) this.#layout(entry)
  }

  destroy(): void {
    this.restoreAll()
    this.#lifecycle.destroy()
    this.#stopListening()
    for (const undo of this.#cleanup.splice(0)) undo()
    const registry = this.#registry()
    registry?.delete(HIGHLIGHT_REPLACE)
    registry?.delete(HIGHLIGHT_GLOSS)
    this.#highlights = undefined
  }

  #apply(range: Range, spec: MarkSpec, reapplies: number): Entry | null {
    if (!this.check(range, spec).ok) return null
    const live = range.cloneRange()
    const original = live.toString()
    const block = blockOf(live.startContainer)
    const id = `overlay-${++this.#seq}`
    const box = el(this.#doc, 'div', {
      className: 'ov-box',
      attrs: { 'data-hoot-lens': id, 'data-action': spec.action }
    })
    const anchor = el(this.#doc, 'mark', {
      attrs: { tabindex: '0', 'aria-describedby': `hoot-lens-desc-${id}` }
    })
    anchor.textContent = spec.action === 'replace' ? spec.text : stripWrappingParens(spec.text)
    box.append(
      anchor,
      el(this.#doc, 'span', {
        text: describeMark(spec, original),
        attrs: { id: `hoot-lens-desc-${id}`, hidden: '' }
      })
    )
    this.#root.layer.append(box)
    const mark = new OverlayMark(id, spec, original, anchor)
    const entry: Entry = { mark, range: live, box, block, blockText: blockTextOf(block), reapplies }
    this.#entries.set(id, entry)
    this.#highlightFor(spec)?.add(live)
    this.#startListening()
    this.#resizeObserver?.observe(block ?? this.#doc.documentElement)
    this.#layout(entry)
    this.#lifecycle.sync()
    return entry
  }

  #forget(entry: Entry): void {
    this.#entries.delete(entry.mark.id)
    if (!this.#entries.size) this.#stopListening()
  }

  #teardown(entry: Entry): void {
    entry.box.remove()
    this.#highlights?.replace.delete(entry.range)
    this.#highlights?.gloss.delete(entry.range)
  }

  #remove(entry: Entry): void {
    this.#forget(entry)
    this.#teardown(entry)
  }

  #layout(entry: Entry): void {
    const rects = this.#rects(entry.range).filter((rect) => rect.width > 0 || rect.height > 0)
    const first = rects[0]
    const last = rects[rects.length - 1]
    entry.box.hidden = !first
    if (!first || !last) return
    const view = viewportOf(this.#doc)
    const content = contentBox(entry.block)
    const right = content ? Math.max(content.right, last.right) : view.width - 8
    if (entry.mark.spec.action === 'replace') this.#layoutReplace(entry, rects, right)
    else this.#layoutGloss(entry, rects, content?.left ?? first.left, right)
  }

  #layoutReplace(entry: Entry, rects: DOMRect[], right: number): void {
    const first = rects[0] as DOMRect
    const view = viewportOf(this.#doc)
    const { box } = entry
    const style = box.style
    const text = copyTextStyle(entry.range, box)
    const lead = Math.max(0, (text.lineHeight - first.height) / 2)
    const left = Math.min(contentBox(entry.block)?.left ?? first.left, first.left)
    box.classList.remove('card')
    style.minWidth = ''
    style.maxWidth = ''
    style.left = `${left + view.scrollX}px`
    style.top = `${first.top - lead + view.scrollY}px`
    style.width = `${Math.max(right - left, first.width)}px`
    style.textIndent = `${first.left - left}px`
    if (fits(entry.mark.anchor, rects)) return
    for (const scale of FONT_SCALES) {
      style.fontSize = `${text.fontSize * scale}px`
      if (fits(entry.mark.anchor, rects)) return
    }
    style.fontSize = `${text.fontSize}px`
    box.classList.add('card')
    style.width = ''
    style.textIndent = '0px'
    style.minWidth = `${first.width}px`
    style.maxWidth = `${right - left}px`
    const width = box.offsetWidth
    style.left = `${Math.max(left, Math.min(first.left, right - width)) + view.scrollX}px`
  }

  #layoutGloss(entry: Entry, rects: DOMRect[], contentLeft: number, right: number): void {
    const first = rects[0] as DOMRect
    const view = viewportOf(this.#doc)
    const style = entry.box.style
    const bottom = Math.max(...rects.map((rect) => rect.bottom))
    style.maxWidth = `${Math.max(right - contentLeft, CARD_MIN_WIDTH)}px`
    const width = entry.box.offsetWidth
    const left = Math.max(contentLeft, Math.min(first.left, right - width))
    style.left = `${left + view.scrollX}px`
    style.top = `${bottom + 4 + view.scrollY}px`
  }

  #schedule = (): void => {
    if (this.#frame) return
    const win = this.#doc.defaultView
    const run = (): void => {
      this.#frame = 0
      this.layout()
    }
    this.#frame = win?.requestAnimationFrame
      ? win.requestAnimationFrame(run)
      : (setTimeout(run, 16) as unknown as number)
  }

  #startListening(): void {
    if (this.#listening) return
    this.#listening = true
    const win = this.#doc.defaultView
    this.#doc.addEventListener('scroll', this.#schedule, { capture: true, passive: true })
    win?.addEventListener('resize', this.#schedule, { passive: true })
    const Observer = win?.ResizeObserver ?? globalThis.ResizeObserver
    if (Observer) {
      this.#resizeObserver = new Observer(this.#schedule)
      this.#resizeObserver.observe(this.#doc.documentElement)
    }
    if (!this.#cleanup.length) this.#cleanup.push(this.#root.styles.applyDocument(HIGHLIGHT_CSS))
  }

  #stopListening(): void {
    if (!this.#listening) return
    this.#listening = false
    this.#doc.removeEventListener('scroll', this.#schedule, { capture: true })
    this.#doc.defaultView?.removeEventListener('resize', this.#schedule)
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
  }

  #registry(): HighlightRegistry | null {
    const win = this.#doc.defaultView as (Window & typeof globalThis) | null
    return win?.CSS?.highlights ?? null
  }

  #highlightFor(spec: MarkSpec): Highlight | null {
    if (this.#highlights === undefined) {
      const win = this.#doc.defaultView as (Window & typeof globalThis) | null
      const registry = this.#registry()
      const Ctor = win?.Highlight
      if (registry && Ctor) {
        this.#highlights = { replace: new Ctor(), gloss: new Ctor() }
        registry.set(HIGHLIGHT_REPLACE, this.#highlights.replace)
        registry.set(HIGHLIGHT_GLOSS, this.#highlights.gloss)
      } else this.#highlights = null
    }
    if (!this.#highlights) return null
    return spec.action === 'replace' ? this.#highlights.replace : this.#highlights.gloss
  }

  #checkIntact(): void {
    for (const entry of [...this.#entries.values()]) {
      const intact =
        entry.range.startContainer.isConnected &&
        entry.range.endContainer.isConnected &&
        entry.range.toString() === entry.mark.original
      if (intact) continue
      this.#remove(entry)
      this.#lifecycle.dropped(
        entry.mark,
        remember(entry.mark, entry.block, entry.blockText, entry.reapplies)
      )
    }
    this.#schedule()
  }

  #reapply(item: Remembered): Mark | null {
    const range = locate(this.#doc, item)
    return range ? (this.#apply(range, item.spec, item.reapplies)?.mark ?? null) : null
  }
}

function contentBox(block: Element | null): { left: number; right: number } | null {
  if (!block) return null
  const rect = block.getBoundingClientRect()
  if (!rect.width) return null
  const style = block.ownerDocument.defaultView?.getComputedStyle(block)
  const px = (value: string | undefined): number => Number.parseFloat(value ?? '') || 0
  return {
    left: rect.left + px(style?.borderLeftWidth) + px(style?.paddingLeft),
    right: rect.right - px(style?.borderRightWidth) - px(style?.paddingRight)
  }
}

interface Line {
  top: number
  bottom: number
  right: number
}

export function toLines(rects: Iterable<DOMRect>): Line[] {
  const sorted = Array.from(rects)
    .filter((rect) => rect.width > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: Line[] = []
  for (const rect of sorted) {
    const line = lines[lines.length - 1]
    const middle = (rect.top + rect.bottom) / 2
    if (line && middle < line.bottom) line.right = Math.max(line.right, rect.right)
    else lines.push({ top: rect.top, bottom: rect.bottom, right: rect.right })
  }
  return lines
}

function fits(anchor: HTMLElement, original: DOMRect[]): boolean {
  const lines = toLines(anchor.getClientRects())
  const originalLines = toLines(original)
  const lastLine = lines[lines.length - 1]
  const lastOriginal = originalLines[originalLines.length - 1]
  if (!lastLine || !lastOriginal) return true
  if (lines.length !== originalLines.length) return lines.length < originalLines.length
  return lastLine.right <= lastOriginal.right + 1
}

function copyTextStyle(range: Range, box: HTMLElement): { fontSize: number; lineHeight: number } {
  const start = range.startContainer
  const source = isElement(start) ? start : start.parentElement
  const view = source?.ownerDocument.defaultView
  if (!source || !view?.getComputedStyle) return { fontSize: 16, lineHeight: 0 }
  const computed = view.getComputedStyle(source)
  for (const prop of TEXT_PROPS) {
    const value = computed.getPropertyValue(prop)
    if (value) box.style.setProperty(prop, value)
  }
  box.style.setProperty('--hl-page-bg', backgroundOf(source))
  const fontSize = Number.parseFloat(computed.fontSize) || 16
  return { fontSize, lineHeight: Number.parseFloat(computed.lineHeight) || 0 }
}

function backgroundOf(element: Element): string {
  const view = element.ownerDocument.defaultView
  for (let current: Element | null = element; current; current = current.parentElement) {
    const color = view?.getComputedStyle(current).backgroundColor ?? ''
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color
  }
  return 'Canvas'
}
