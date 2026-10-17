const SVG_NS = 'http://www.w3.org/2000/svg'

type Shape = [tag: string, attrs: Record<string, string>]

const OWL: Shape[] = [
  ['path', { d: 'M4 10c0-3.6 3.1-7 8-7s8 3.4 8 7v4c0 4.1-3.6 7-8 7s-8-2.9-8-7z', class: 'face' }],
  ['circle', { cx: '8.6', cy: '11.2', r: '2.7', class: 'eye' }],
  ['circle', { cx: '15.4', cy: '11.2', r: '2.7', class: 'eye' }],
  ['circle', { cx: '8.6', cy: '11.4', r: '1', class: 'pupil' }],
  ['circle', { cx: '15.4', cy: '11.4', r: '1', class: 'pupil' }],
  ['path', { d: 'M12 13.6l-1.3 1.9h2.6z', class: 'beak' }]
]

export const ICON_CSS = `
.icon {
  flex: none;
  width: 16px;
  height: 16px;
}
.icon .face {
  fill: color-mix(in srgb, var(--hl-accent) 18%, transparent);
  stroke: var(--hl-accent);
  stroke-width: 1.4;
}
.icon .eye {
  fill: var(--hl-surface-solid);
  stroke: var(--hl-accent);
  stroke-width: 1.2;
}
.icon .pupil,
.icon .beak {
  fill: var(--hl-accent);
}
`

export function owlIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const [tag, attrs] of OWL) {
    const shape = doc.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value)
    svg.append(shape)
  }
  return svg
}
