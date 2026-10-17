import { COPY } from '../copy'
import { el } from '../dom'
import type { Mark } from '../render/types'
import { placeNear, viewportOf } from './position'
import type { UiRoot } from './root'

export const POPOVER_CSS = `
.popover {
  position: absolute;
  box-sizing: border-box;
  width: max-content;
  max-width: min(360px, calc(100vw - 16px));
  padding: 12px 12px 10px;
  pointer-events: auto;
  background: var(--hl-surface);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--hl-hairline);
  border-top-color: var(--hl-edge-top);
  border-radius: var(--hl-radius);
  box-shadow: var(--hl-shadow);
}
.label {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--hl-text-2);
}
.original {
  margin: 0;
  max-height: 9.5em;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  -webkit-user-select: text;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
@media (forced-colors: active) {
  .popover {
    border: 1px solid CanvasText;
  }
}
`

export interface PopoverHandlers {
  restore(mark: Mark): void
}

export class Popover {
  readonly element: HTMLElement
  readonly #root: UiRoot
  readonly #handlers: PopoverHandlers
  readonly #original: HTMLElement
  #mark: Mark | null = null

  constructor(root: UiRoot, handlers: PopoverHandlers) {
    this.#root = root
    this.#handlers = handlers
    const doc = root.document
    root.styles.apply(root.shadow, POPOVER_CSS)
    this.element = el(doc, 'div', {
      className: 'popover',
      attrs: { role: 'dialog', 'aria-label': COPY.popoverLabel, hidden: '' }
    })
    this.#original = el(doc, 'p', { className: 'original' })
    const restore = el(doc, 'button', {
      className: 'btn primary',
      text: COPY.restore,
      attrs: { type: 'button', 'data-action': 'restore' }
    })
    restore.addEventListener('click', () => {
      const mark = this.#mark
      if (!mark) return
      this.hide()
      this.#handlers.restore(mark)
    })
    const actions = el(doc, 'div', { className: 'actions' })
    actions.append(restore)
    this.element.append(
      el(doc, 'p', { className: 'label', text: COPY.original }),
      this.#original,
      actions
    )
    root.layer.append(this.element)
  }

  get mark(): Mark | null {
    return this.#mark
  }

  get open(): boolean {
    return this.#mark !== null
  }

  show(mark: Mark): void {
    this.#mark = mark
    this.#original.textContent = mark.original
    this.element.hidden = false
    this.reposition()
  }

  hide(): void {
    this.#mark = null
    this.element.hidden = true
  }

  reposition(): void {
    const mark = this.#mark
    if (!mark) return
    const rect = mark.rects()[0] ?? mark.anchor.getBoundingClientRect()
    const size = { width: this.element.offsetWidth, height: this.element.offsetHeight }
    const place = placeNear(rect, size, viewportOf(this.#root.document))
    this.element.style.left = `${place.left}px`
    this.element.style.top = `${place.top}px`
    this.element.style.transformOrigin = `${place.originX}px ${place.originY}px`
    this.element.dataset.side = place.side
  }

  destroy(): void {
    this.element.remove()
  }
}
