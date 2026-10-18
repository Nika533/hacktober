import { el } from '../dom'
import type { UiRoot } from './root'

export const ANNOUNCER_CSS = `
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`

export class Announcer {
  readonly element: HTMLElement

  constructor(root: UiRoot) {
    root.styles.apply(root.shadow, ANNOUNCER_CSS)
    this.element = el(root.document, 'div', {
      className: 'sr-only',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }
    })
    root.layer.append(this.element)
  }

  say(message: string): void {
    this.element.textContent = ''
    queueMicrotask(() => {
      this.element.textContent = message
    })
  }
}
