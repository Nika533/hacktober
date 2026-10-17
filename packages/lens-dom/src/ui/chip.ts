import { COPY } from '../copy'
import { el } from '../dom'
import { owlIcon } from './icons'
import { DURATION, Presence } from './motion'
import { placeNear, viewportOf, type Box } from './position'
import type { UiRoot } from './root'

export const CHIP_CSS = `
.chip {
  position: absolute;
  width: max-content;
  white-space: nowrap;
  pointer-events: auto;
  min-height: 28px;
  padding: 0 12px 0 8px;
  border-radius: 999px;
  background: var(--hl-surface);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--hl-hairline);
  border-top-color: var(--hl-edge-top);
  box-shadow: var(--hl-shadow);
  will-change: transform, opacity;
}
.chip:hover {
  background: var(--hl-surface);
  color: var(--hl-accent);
}
@media (forced-colors: active) {
  .chip {
    border: 1px solid ButtonText;
  }
}
`

export class AskChip {
  readonly element: HTMLButtonElement
  readonly #root: UiRoot
  readonly #presence: Presence

  constructor(root: UiRoot, onAsk: () => void, options: { animate?: boolean } = {}) {
    this.#root = root
    const doc = root.document
    root.styles.apply(root.shadow, CHIP_CSS)
    this.element = el(doc, 'button', {
      className: 'btn chip',
      attrs: {
        type: 'button',
        'data-action': 'ask',
        'aria-keyshortcuts': 'Alt+L',
        hidden: ''
      }
    })
    this.element.append(owlIcon(doc), el(doc, 'span', { text: COPY.ask }))
    this.element.addEventListener('mousedown', (event) => event.preventDefault())
    this.element.addEventListener('click', () => onAsk())
    this.#presence = new Presence(
      this.element,
      { document: doc, animate: options.animate ?? true },
      (isReduced) =>
        isReduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.92)' },
              { opacity: 1, transform: 'scale(1)' }
            ],
      DURATION.chip
    )
    root.layer.append(this.element)
  }

  get visible(): boolean {
    return this.#presence.visible
  }

  show(anchor: Box): void {
    this.#presence.show()
    const size = { width: this.element.offsetWidth, height: this.element.offsetHeight }
    const place = placeNear(anchor, size, viewportOf(this.#root.document), 8)
    this.element.style.left = `${place.left}px`
    this.element.style.top = `${place.top}px`
    this.element.style.transformOrigin = `${place.originX}px ${place.originY}px`
  }

  hide(): void {
    void this.#presence.hide()
  }

  destroy(): void {
    this.element.remove()
  }
}
