import { el } from '../dom'
import { viewportOf } from './position'
import type { UiRoot } from './root'

export const SHIMMER_CSS = `
@keyframes hl-shimmer {
  from {
    background-position: 160% 0;
  }
  to {
    background-position: -60% 0;
  }
}
.shimmer {
  position: absolute;
  pointer-events: none;
  border-radius: 3px;
  background-color: color-mix(in srgb, var(--hl-accent) 8%, transparent);
  background-image: linear-gradient(
    100deg,
    transparent 25%,
    color-mix(in srgb, var(--hl-accent) 24%, transparent) 50%,
    transparent 75%
  );
  background-size: 220% 100%;
  background-repeat: no-repeat;
  animation: hl-shimmer 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
    background-image: none;
    background-color: var(--hl-tint);
  }
}
@media (forced-colors: active) {
  .shimmer {
    background: none;
    outline: 1px dashed Highlight;
  }
}
`

export interface ThinkingHandle {
  done(): void
}

export class Shimmer {
  readonly #root: UiRoot

  constructor(root: UiRoot) {
    this.#root = root
    root.styles.apply(root.shadow, SHIMMER_CSS)
  }

  show(rects: DOMRect[]): ThinkingHandle {
    const view = viewportOf(this.#root.document)
    const boxes = rects
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => {
        const box = el(this.#root.document, 'div', {
          className: 'shimmer',
          attrs: { 'aria-hidden': 'true' }
        })
        box.style.left = `${rect.left + view.scrollX}px`
        box.style.top = `${rect.top + view.scrollY}px`
        box.style.width = `${rect.width}px`
        box.style.height = `${rect.height}px`
        this.#root.layer.append(box)
        return box
      })
    return { done: () => boxes.forEach((box) => box.remove()) }
  }
}
