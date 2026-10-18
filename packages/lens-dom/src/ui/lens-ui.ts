import { isElement } from '../dom'
import type { Mark } from '../render/types'
import { Announcer } from './announcer'
import { AskChip } from './chip'
import { ICON_CSS } from './icons'
import { PagePill } from './pill'
import { Popover } from './popover'
import type { Box } from './position'
import type { UiRoot } from './root'
import { Shimmer, type ThinkingHandle } from './shimmer'

export interface LensUiHandlers {
  restore(mark: Mark): void
  knewIt(mark: Mark): void
  explainMore(mark: Mark): void
  copyRewritten(mark: Mark): void
  undoLast(): void
  undoAll(): void
  togglePause(): void
  ask(): void
}

export interface LensUiOptions {
  root: UiRoot
  handlers: LensUiHandlers
  animate?: boolean
  trustedOnly?: boolean
  openDelayMs?: number
  closeDelayMs?: number
}

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditableTarget(event: Event): boolean {
  const target = event.composedPath()[0]
  if (!isElement(target as Node)) return false
  const element = target as HTMLElement
  return EDITABLE.has(element.tagName) || element.isContentEditable === true
}

function keyOf(event: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase()
  return event.key.toLowerCase()
}

export class LensUi {
  readonly popover: Popover
  readonly pill: PagePill
  readonly chip: AskChip
  readonly shimmer: Shimmer
  readonly announcer: Announcer
  readonly #root: UiRoot
  readonly #handlers: LensUiHandlers
  readonly #trustedOnly: boolean
  readonly #openDelay: number
  readonly #closeDelay: number
  readonly #marks = new Map<string, () => void>()
  #openTimer: ReturnType<typeof setTimeout> | null = null
  #closeTimer: ReturnType<typeof setTimeout> | null = null
  #frame = 0

  constructor(options: LensUiOptions) {
    const { root, handlers } = options
    const animate = options.animate ?? true
    this.#root = root
    this.#handlers = handlers
    this.#trustedOnly = options.trustedOnly ?? true
    this.#openDelay = options.openDelayMs ?? 80
    this.#closeDelay = options.closeDelayMs ?? 250
    root.styles.apply(root.shadow, ICON_CSS)
    this.popover = new Popover(root, handlers, { animate })
    this.pill = new PagePill(root, handlers, { animate })
    this.chip = new AskChip(root, () => handlers.ask(), { animate })
    this.shimmer = new Shimmer(root)
    this.announcer = new Announcer(root)
    this.popover.element.addEventListener('pointerenter', () => this.#cancelClose())
    this.popover.element.addEventListener('pointerleave', () => this.#scheduleClose())
    const doc = root.document
    doc.addEventListener('keydown', this.#onKeydown, true)
    doc.addEventListener('scroll', this.#onScroll, { capture: true, passive: true })
    doc.defaultView?.addEventListener('resize', this.#onScroll, { passive: true })
  }

  attach(mark: Mark): void {
    this.detach(mark.id)
    const { anchor } = mark
    const enter = (): void => this.#scheduleOpen(mark)
    const leave = (): void => this.#scheduleClose()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      this.#cancelTimers()
      this.popover.show(mark, { focus: true })
    }
    anchor.addEventListener('pointerenter', enter)
    anchor.addEventListener('pointerleave', leave)
    anchor.addEventListener('keydown', keydown)
    this.#marks.set(mark.id, () => {
      anchor.removeEventListener('pointerenter', enter)
      anchor.removeEventListener('pointerleave', leave)
      anchor.removeEventListener('keydown', keydown)
    })
  }

  detach(id: string): void {
    this.#marks.get(id)?.()
    this.#marks.delete(id)
    if (this.popover.mark?.id === id) this.popover.hide({ immediate: true })
  }

  setCount(count: number, paused = this.pill.paused): void {
    this.pill.update(count, paused)
  }

  thinking(rects: DOMRect[], message: string): ThinkingHandle {
    this.announcer.say(message)
    return this.shimmer.show(rects)
  }

  announce(message: string): void {
    this.announcer.say(message)
  }

  showChip(anchor: Box): void {
    this.chip.show(anchor)
  }

  hideChip(): void {
    this.chip.hide()
  }

  destroy(): void {
    this.#cancelTimers()
    for (const cleanup of this.#marks.values()) cleanup()
    this.#marks.clear()
    const doc = this.#root.document
    doc.removeEventListener('keydown', this.#onKeydown, true)
    doc.removeEventListener('scroll', this.#onScroll, { capture: true })
    doc.defaultView?.removeEventListener('resize', this.#onScroll)
    this.popover.destroy()
    this.pill.destroy()
    this.chip.destroy()
  }

  #scheduleOpen(mark: Mark): void {
    this.#cancelClose()
    if (this.popover.mark === mark) return
    if (this.#openTimer) clearTimeout(this.#openTimer)
    this.#openTimer = setTimeout(() => {
      this.#openTimer = null
      this.popover.show(mark)
    }, this.#openDelay)
  }

  #scheduleClose(): void {
    if (this.#openTimer) clearTimeout(this.#openTimer)
    this.#openTimer = null
    if (this.#closeTimer) clearTimeout(this.#closeTimer)
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null
      if (this.popover.contains(this.#root.shadow.activeElement)) return
      this.popover.hide()
    }, this.#closeDelay)
  }

  #cancelClose(): void {
    if (this.#closeTimer) clearTimeout(this.#closeTimer)
    this.#closeTimer = null
  }

  #cancelTimers(): void {
    this.#cancelClose()
    if (this.#openTimer) clearTimeout(this.#openTimer)
    this.#openTimer = null
  }

  #onScroll = (): void => {
    if (!this.popover.open || this.#frame) return
    const win = this.#root.document.defaultView
    const run = (): void => {
      this.#frame = 0
      this.popover.reposition()
    }
    this.#frame = win?.requestAnimationFrame
      ? win.requestAnimationFrame(run)
      : (setTimeout(run, 16) as unknown as number)
  }

  #onKeydown = (event: KeyboardEvent): void => {
    if (this.#trustedOnly && !event.isTrusted) return
    if (event.key === 'Escape') {
      if (this.popover.open) {
        event.preventDefault()
        this.popover.hide({ returnFocus: true })
      } else if (this.chip.visible) {
        event.preventDefault()
        this.chip.hide()
      }
      return
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event)) return
    const key = keyOf(event)
    if (key === 'z' && event.shiftKey) this.#handlers.undoAll()
    else if (key === 'z') this.#handlers.undoLast()
    else if (key === 'h' && !event.shiftKey) this.#handlers.togglePause()
    else if (key === 'l' && !event.shiftKey && this.chip.visible) this.#handlers.ask()
    else return
    event.preventDefault()
    event.stopPropagation()
  }
}
