import {
  InlineRenderer,
  OverlayRenderer,
  Popover,
  createUiRoot,
  type Mark,
  type Renderer
} from '../src/index'

const REWRITES: Record<string, string> = {
  heteroscedasticity: 'heteroscedasticity (when the spread of errors changes across values)',
  OLS: 'ordinary least squares (OLS)',
  BLUE: 'BLUE (the best linear unbiased estimator)'
}

const params = new URLSearchParams(location.search)
const ui = createUiRoot({ document, shadowMode: 'open' })
const renderer: Renderer =
  params.get('renderer') === 'overlay'
    ? new OverlayRenderer({ document, root: ui })
    : new InlineRenderer({ document, shadowMode: 'open' })
const action = params.get('action') === 'gloss' ? 'gloss' : 'replace'
const popover = new Popover(ui, { restore: (mark) => renderer.restore(mark.id) })
let hideTimer = 0

const rewriteFor = (text: string): string =>
  REWRITES[text.trim()] ?? `in plain words: ${text.trim().toLowerCase()}`

const open = (mark: Mark): void => {
  window.clearTimeout(hideTimer)
  popover.show(mark)
}

const closeSoon = (): void => {
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => popover.hide(), 250)
}

function watch(mark: Mark): void {
  mark.anchor.addEventListener('pointerenter', () => open(mark))
  mark.anchor.addEventListener('pointerleave', closeSoon)
  mark.anchor.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    open(mark)
    popover.element.querySelector<HTMLElement>('button')?.focus()
  })
}

popover.element.addEventListener('pointerenter', () => window.clearTimeout(hideTimer))
popover.element.addEventListener('pointerleave', closeSoon)
popover.element.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  const mark = popover.mark
  popover.hide()
  mark?.anchor.focus()
})

renderer.subscribe((event) => {
  if (event.type === 'reapplied') watch(event.mark)
})

document.addEventListener('pointerup', (event) => {
  if (event.composedPath().includes(ui.host)) return
  requestAnimationFrame(() => {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    const mark = renderer.apply(range, {
      action,
      transform: 'define',
      text: rewriteFor(range.toString())
    })
    selection.removeAllRanges()
    if (mark) watch(mark)
  })
})

Object.assign(window, { __hootLens: { renderer, popover, ui } })
