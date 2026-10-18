import { COPY, changedCount } from '../copy'
import { el } from '../dom'
import { owlIcon } from './icons'
import { DURATION, Presence } from './motion'
import type { UiRoot } from './root'

export const PILL_CSS = `
.pill {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 10px;
  pointer-events: auto;
  background: var(--hl-surface);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--hl-hairline);
  border-top-color: var(--hl-edge-top);
  border-radius: 999px;
  box-shadow: var(--hl-shadow);
  font: 500 12.5px/1 var(--hl-font);
  color: var(--hl-text);
  will-change: transform, opacity;
}
.pill .status {
  padding: 0 4px 0 2px;
  white-space: nowrap;
}
.pill .btn {
  min-height: 26px;
  border-radius: 999px;
  white-space: nowrap;
}
@media (forced-colors: active) {
  .pill {
    border: 1px solid CanvasText;
  }
}
`

export interface PillHandlers {
  undoAll(): void
  togglePause(): void
}

export class PagePill {
  readonly element: HTMLElement
  readonly #status: HTMLElement
  readonly #undo: HTMLButtonElement
  readonly #pause: HTMLButtonElement
  readonly #presence: Presence
  #count = 0
  #paused = false
  #timer: ReturnType<typeof setTimeout> | null = null
  #hovered = false
  readonly #copy: { pause: string; paused: string }

  constructor(
    root: UiRoot,
    handlers: PillHandlers,
    options: { animate?: boolean; localFiles?: boolean } = {}
  ) {
    const doc = root.document
    this.#copy = options.localFiles
      ? { pause: COPY.pauseLocal, paused: COPY.pausedLocal }
      : { pause: COPY.pause, paused: COPY.paused }
    root.styles.apply(root.shadow, PILL_CSS)
    this.element = el(doc, 'div', {
      className: 'pill',
      attrs: { role: 'region', 'aria-label': COPY.pillLabel, hidden: '' }
    })
    this.#status = el(doc, 'span', {
      className: 'status',
      attrs: { role: 'status', 'aria-live': 'polite' }
    })
    this.#undo = el(doc, 'button', {
      className: 'btn',
      text: COPY.undoAll,
      attrs: { type: 'button', 'data-action': 'undo-all', 'aria-keyshortcuts': 'Alt+Shift+Z' }
    })
    this.#pause = el(doc, 'button', {
      className: 'btn',
      text: this.#copy.pause,
      attrs: { type: 'button', 'data-action': 'pause', 'aria-keyshortcuts': 'Alt+H' }
    })
    this.#undo.addEventListener('click', () => handlers.undoAll())
    this.#pause.addEventListener('click', () => handlers.togglePause())
    this.element.append(owlIcon(doc), this.#status, this.#undo, this.#pause)
    for (const [type, value] of [
      ['pointerenter', true],
      ['pointerleave', false],
      ['focusin', true],
      ['focusout', false]
    ] as const) {
      this.element.addEventListener(type, () => {
        this.#hovered = value
        if (!value) this.#scheduleAutoHide()
      })
    }
    this.#presence = new Presence(
      this.element,
      { document: doc, animate: options.animate ?? true },
      (isReduced) =>
        isReduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'translateY(8px)' },
              { opacity: 1, transform: 'translateY(0)' }
            ],
      DURATION.pill
    )
    root.layer.append(this.element)
  }

  get count(): number {
    return this.#count
  }

  get paused(): boolean {
    return this.#paused
  }

  update(count: number, paused = this.#paused): void {
    this.#count = count
    this.#paused = paused
    this.#undo.hidden = paused || count === 0
    this.#pause.textContent = paused ? COPY.resume : this.#copy.pause
    this.#status.textContent = paused ? this.#copy.paused : changedCount(count)
    if (count > 0 || paused) this.#presence.show()
    else void this.#presence.hide()
    this.#scheduleAutoHide()
  }

  destroy(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.element.remove()
  }

  #scheduleAutoHide(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    if (!this.#paused || this.#count > 0) return
    this.#timer = setTimeout(() => {
      if (!this.#hovered && this.#paused && this.#count === 0) void this.#presence.hide()
    }, 5000)
  }
}
