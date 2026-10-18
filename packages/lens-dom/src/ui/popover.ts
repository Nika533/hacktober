import { TRANSFORM_RULES } from '@hoot/core'
import { COPY } from '../copy'
import { el } from '../dom'
import type { Mark } from '../render/types'
import { DURATION, Presence } from './motion'
import { placeNear, viewportOf } from './position'
import type { UiRoot } from './root'

export const POPOVER_CSS = `
.popover {
  position: absolute;
  box-sizing: border-box;
  width: max-content;
  max-width: min(360px, calc(100vw - 16px));
  padding: 12px 12px 8px;
  pointer-events: auto;
  background: var(--hl-surface);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--hl-hairline);
  border-top-color: var(--hl-edge-top);
  border-radius: var(--hl-radius);
  box-shadow: var(--hl-shadow);
  will-change: transform, opacity;
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
.stakes {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--hl-surface-2);
  font-size: 12px;
  color: var(--hl-text-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--hl-hairline);
  font-size: 11.5px;
  color: var(--hl-text-2);
}
.link-btn {
  all: unset;
  cursor: pointer;
  border-radius: 4px;
  color: var(--hl-accent);
  font: 500 11.5px/1.6 var(--hl-font);
}
.link-btn:hover {
  text-decoration: underline;
}
.link-btn:focus-visible {
  outline: 2px solid var(--hl-accent);
  outline-offset: 2px;
}
@media (forced-colors: active) {
  .popover {
    border: 1px solid CanvasText;
  }
}
`

export interface PopoverHandlers {
  restore(mark: Mark): void
  knewIt(mark: Mark): void
  explainMore(mark: Mark): void
  copyRewritten(mark: Mark): void
}

type Action = keyof PopoverHandlers

export interface PopoverOptions {
  animate?: boolean
}

export class Popover {
  readonly element: HTMLElement
  readonly #root: UiRoot
  readonly #handlers: PopoverHandlers
  readonly #presence: Presence
  readonly #label: HTMLElement
  readonly #original: HTMLElement
  readonly #stakes: HTMLElement
  readonly #transform: HTMLElement
  readonly #buttons: Record<Action, HTMLButtonElement>
  #mark: Mark | null = null

  constructor(root: UiRoot, handlers: PopoverHandlers, options: PopoverOptions = {}) {
    this.#root = root
    this.#handlers = handlers
    const doc = root.document
    root.styles.apply(root.shadow, POPOVER_CSS)
    this.element = el(doc, 'div', {
      className: 'popover',
      attrs: {
        role: 'dialog',
        'aria-label': COPY.popoverLabel,
        'aria-describedby': 'hoot-lens-pop-original',
        hidden: ''
      }
    })
    this.#label = el(doc, 'p', { className: 'label', text: COPY.original })
    this.#original = el(doc, 'p', {
      className: 'original',
      attrs: { id: 'hoot-lens-pop-original' }
    })
    this.#stakes = el(doc, 'p', {
      className: 'stakes',
      text: COPY.highStakes,
      attrs: { hidden: '' }
    })
    this.#transform = el(doc, 'span', { className: 'transform' })
    const button = (action: Action, text: string, className = 'btn'): HTMLButtonElement => {
      const node = el(doc, 'button', {
        className,
        text,
        attrs: { type: 'button', 'data-action': action }
      })
      node.addEventListener('click', () => this.#run(action))
      return node
    }
    this.#buttons = {
      restore: button('restore', COPY.restore, 'btn primary'),
      knewIt: button('knewIt', COPY.knewIt),
      explainMore: button('explainMore', COPY.explainMore),
      copyRewritten: button('copyRewritten', COPY.copyRewritten, 'link-btn')
    }
    const actions = el(doc, 'div', { className: 'actions' })
    actions.append(this.#buttons.restore, this.#buttons.knewIt, this.#buttons.explainMore)
    const footer = el(doc, 'div', { className: 'footer' })
    footer.append(this.#transform, this.#buttons.copyRewritten)
    this.element.append(this.#label, this.#original, this.#stakes, actions, footer)
    this.element.addEventListener('keydown', (event) => this.#onKeydown(event))
    this.#presence = new Presence(
      this.element,
      { document: doc, animate: options.animate ?? true },
      (isReduced) =>
        isReduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.96)' },
              { opacity: 1, transform: 'scale(1)' }
            ],
      DURATION.popover
    )
    root.layer.append(this.element)
  }

  get mark(): Mark | null {
    return this.#mark
  }

  get open(): boolean {
    return this.#mark !== null
  }

  show(mark: Mark, options: { focus?: boolean } = {}): void {
    const changed = this.#mark !== mark
    this.#mark = mark
    if (changed) this.#fill(mark)
    this.#presence.show()
    this.reposition()
    if (options.focus) this.#buttons.restore.focus()
  }

  hide(options: { returnFocus?: boolean; immediate?: boolean } = {}): void {
    const mark = this.#mark
    this.#mark = null
    if (options.returnFocus && mark?.anchor.isConnected) mark.anchor.focus()
    if (options.immediate) this.#presence.hideNow()
    else void this.#presence.hide()
  }

  contains(node: Node | null): boolean {
    return !!node && this.element.contains(node)
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

  #fill(mark: Mark): void {
    const gloss = mark.spec.action === 'gloss'
    this.#label.textContent = gloss ? COPY.note : COPY.original
    this.#original.textContent = gloss ? mark.spec.text : mark.original
    this.#buttons.restore.textContent = gloss ? COPY.removeNote : COPY.restore
    this.#buttons.copyRewritten.hidden = gloss
    this.#buttons.copyRewritten.textContent = COPY.copyRewritten
    this.#stakes.hidden = !mark.spec.highStakes
    this.#transform.textContent = TRANSFORM_RULES[mark.spec.transform].label
  }

  #run(action: Action): void {
    const mark = this.#mark
    if (!mark) return
    if (action === 'copyRewritten') {
      this.#handlers.copyRewritten(mark)
      this.#buttons.copyRewritten.textContent = COPY.copied
      return
    }
    const keyboard = this.#root.shadow.activeElement !== null
    if (keyboard && mark.anchor.isConnected) mark.anchor.focus()
    this.hide()
    this.#handlers[action](mark)
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.hide({ returnFocus: true })
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(this.element.querySelectorAll<HTMLElement>('button')).filter(
      (node) => !node.hidden
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = this.#root.shadow.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
