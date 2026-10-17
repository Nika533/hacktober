export const ACCENT = '#5b8def'

export const HIGHLIGHT_REPLACE = 'hoot-lens-replace'
export const HIGHLIGHT_GLOSS = 'hoot-lens-gloss'

export const HIGHLIGHT_CSS = `
::highlight(${HIGHLIGHT_REPLACE}) {
  color: transparent;
}
::highlight(${HIGHLIGHT_GLOSS}) {
  background-color: color-mix(in srgb, ${ACCENT} 12%, transparent);
  text-decoration: underline dotted color-mix(in srgb, ${ACCENT} 60%, transparent);
}
@media (prefers-contrast: more) {
  ::highlight(${HIGHLIGHT_GLOSS}) {
    background-color: transparent;
    text-decoration: underline solid ${ACCENT};
  }
}
`

export const TOKENS_CSS = `
:host {
  --hl-accent: ${ACCENT};
  --hl-on-accent: #ffffff;
  --hl-tint: color-mix(in srgb, var(--hl-accent) 12%, transparent);
  --hl-underline: color-mix(in srgb, var(--hl-accent) 60%, transparent);
  --hl-surface: rgba(250, 250, 252, 0.94);
  --hl-surface-solid: #fafafc;
  --hl-surface-2: rgba(0, 0, 0, 0.04);
  --hl-edge-top: rgba(255, 255, 255, 0.55);
  --hl-hairline: rgba(0, 0, 0, 0.08);
  --hl-text: #1d1d1f;
  --hl-text-2: rgba(29, 29, 31, 0.62);
  --hl-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.14);
  --hl-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.12), 0 6px 18px rgba(0, 0, 0, 0.16);
  --hl-font: 'Segoe UI Variable', system-ui, 'Segoe UI', sans-serif;
  --hl-radius: 12px;
  --hl-radius-btn: 8px;
}
@media (prefers-color-scheme: dark) {
  :host {
    --hl-surface: rgba(30, 30, 34, 0.92);
    --hl-surface-solid: #1e1e22;
    --hl-surface-2: rgba(255, 255, 255, 0.06);
    --hl-edge-top: rgba(255, 255, 255, 0.08);
    --hl-hairline: rgba(255, 255, 255, 0.1);
    --hl-text: #f5f5f7;
    --hl-text-2: rgba(245, 245, 247, 0.6);
  }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  :host {
    --hl-surface: var(--hl-surface-solid);
    --hl-edge-top: var(--hl-hairline);
  }
}
@media (prefers-contrast: more) {
  :host {
    --hl-hairline: currentColor;
    --hl-text-2: var(--hl-text);
  }
}
[hidden] {
  display: none !important;
}
`

export const MARK_CSS = `
${TOKENS_CSS}
:host {
  display: inline !important;
}
mark {
  all: unset;
  background-color: var(--hl-tint);
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--hl-underline);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.2em;
  border-radius: 3px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
mark:focus-visible {
  outline: 2px solid var(--hl-accent);
  outline-offset: 1px;
}
.gloss {
  font-size: 0.92em;
  color: color-mix(in srgb, currentColor 72%, transparent);
}
.gloss[data-placement='block'] {
  display: block;
  margin: 0.25em 0 0.35em;
  padding-inline-start: 0.6em;
  border-inline-start: 2px solid var(--hl-underline);
}
@media (prefers-contrast: more) {
  mark {
    background-color: transparent;
    box-shadow: inset 0 0 0 1px var(--hl-accent);
    text-decoration-style: solid;
  }
  .gloss {
    color: inherit;
  }
}
@media (forced-colors: active) {
  mark {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
    box-shadow: none;
    text-decoration-color: HighlightText;
  }
}
`

export class StyleSheets {
  readonly #doc: Document
  readonly #sheets = new Map<string, CSSStyleSheet | null>()

  constructor(doc: Document) {
    this.#doc = doc
  }

  apply(root: ShadowRoot, css: string): void {
    const sheet = 'adoptedStyleSheets' in root ? this.#sheet(css) : null
    if (sheet) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      return
    }
    const style = this.#doc.createElement('style')
    style.textContent = css
    root.prepend(style)
  }

  applyDocument(css: string): () => void {
    const doc = this.#doc
    const sheet = 'adoptedStyleSheets' in doc ? this.#sheet(css) : null
    if (sheet) {
      if (!doc.adoptedStyleSheets.includes(sheet)) {
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
      }
      return () => {
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((item) => item !== sheet)
      }
    }
    const style = doc.createElement('style')
    style.textContent = css
    ;(doc.head ?? doc.documentElement).append(style)
    return () => style.remove()
  }

  #sheet(css: string): CSSStyleSheet | null {
    if (!this.#sheets.has(css)) {
      let sheet: CSSStyleSheet | null = null
      try {
        const Ctor = this.#doc.defaultView?.CSSStyleSheet
        if (Ctor) {
          sheet = new Ctor()
          sheet.replaceSync(css)
        }
      } catch {
        sheet = null
      }
      this.#sheets.set(css, sheet)
    }
    return this.#sheets.get(css) ?? null
  }
}
