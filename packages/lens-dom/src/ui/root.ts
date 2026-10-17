import { el } from '../dom'
import { StyleSheets, TOKENS_CSS } from './styles'

export const UI_TAG = 'hoot-lens-ui'

export const UI_BASE_CSS = `
${TOKENS_CSS}
:host {
  all: initial !important;
  display: block !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
}
.layer {
  position: absolute;
  top: 0;
  left: 0;
  font: 13px/1.45 var(--hl-font);
  color: var(--hl-text);
  -webkit-font-smoothing: antialiased;
}
.btn {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--hl-radius-btn);
  background: var(--hl-surface-2);
  color: var(--hl-text);
  font: 500 12.5px/1 var(--hl-font);
  cursor: pointer;
  transition:
    transform 100ms ease-out,
    background-color 120ms ease-out;
}
.btn:hover {
  background: color-mix(in srgb, var(--hl-accent) 14%, transparent);
}
.btn:active {
  transform: scale(0.97);
}
.btn:focus-visible {
  outline: 2px solid var(--hl-accent);
  outline-offset: 2px;
}
.btn.primary {
  background: var(--hl-accent);
  color: var(--hl-on-accent);
}
@media (prefers-contrast: more) {
  .btn {
    box-shadow: inset 0 0 0 1px currentColor;
  }
}
@media (forced-colors: active) {
  .btn {
    border: 1px solid ButtonText;
  }
}
`

export interface UiRoot {
  readonly document: Document
  readonly host: HTMLElement
  readonly shadow: ShadowRoot
  readonly layer: HTMLElement
  readonly styles: StyleSheets
  destroy(): void
}

export interface UiRootOptions {
  document: Document
  shadowMode?: ShadowRootMode
  styles?: StyleSheets
}

export function createUiRoot(options: UiRootOptions): UiRoot {
  const doc = options.document
  const styles = options.styles ?? new StyleSheets(doc)
  const host = doc.createElement(UI_TAG)
  const shadow = host.attachShadow({ mode: options.shadowMode ?? 'closed' })
  styles.apply(shadow, UI_BASE_CSS)
  const layer = el(doc, 'div', { className: 'layer' })
  shadow.append(layer)
  doc.documentElement.append(host)
  return { document: doc, host, shadow, layer, styles, destroy: () => host.remove() }
}
