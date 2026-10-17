import {
  COPY,
  CopyController,
  InlineRenderer,
  LensUi,
  OverlayRenderer,
  TRANSFORM_LABEL,
  announceChange,
  createUiRoot,
  type Mark,
  type MarkSpec,
  type Renderer
} from '../src/index'

const REWRITES: Record<string, string> = {
  heteroscedasticity: 'heteroscedasticity (when the spread of errors changes across values)',
  OLS: 'ordinary least squares (OLS)',
  BLUE: 'BLUE (the best linear unbiased estimator)'
}

const params = new URLSearchParams(location.search)
const root = createUiRoot({ document, shadowMode: 'open' })
const inline = new InlineRenderer({ document, shadowMode: 'open' })
const renderer: Renderer =
  params.get('renderer') === 'overlay' ? new OverlayRenderer({ document, root }) : inline
const action = params.get('action') === 'gloss' ? 'gloss' : 'replace'
const highStakes = params.has('stakes')
const order: string[] = []
let paused = false
let pending: Range | null = null

const copy = new CopyController({
  document,
  mode: () => (params.get('copy') === 'visible' ? 'visible' : 'original'),
  visibleText: (host) => inline.visibleText(host)
})

const sync = (): void => ui.setCount(renderer.marks().length, paused)

const restore = (mark: Mark, animate = true): void => {
  ui.detach(mark.id)
  renderer.restore(mark.id, { animate })
  order.splice(order.indexOf(mark.id), 1)
  ui.announce(COPY.restored)
  sync()
}

const ui = new LensUi({
  root,
  trustedOnly: false,
  handlers: {
    restore: (mark) => restore(mark),
    knewIt: (mark) => restore(mark),
    explainMore: (mark) => ui.announce(`Explain more: ${mark.original}`),
    copyRewritten: (mark) => void copy.writeText(mark.spec.text),
    undoLast: () => {
      const mark = renderer.get(order[order.length - 1] ?? '')
      if (mark) restore(mark)
    },
    undoAll: () => {
      for (const mark of renderer.marks()) ui.detach(mark.id)
      renderer.restoreAll({ animate: true })
      order.length = 0
      ui.announce(COPY.restoredAll)
      sync()
    },
    togglePause: () => {
      paused = !paused
      if (paused) {
        for (const mark of renderer.marks()) ui.detach(mark.id)
        renderer.restoreAll({ animate: true })
        order.length = 0
      }
      sync()
    },
    ask: () => {
      const range = pending
      pending = null
      ui.hideChip()
      if (range) rewrite(range)
    }
  }
})

const rewriteFor = (text: string): string =>
  REWRITES[text.trim()] ?? `in plain words: ${text.trim().toLowerCase()}`

function rewrite(range: Range): void {
  document.getSelection()?.removeAllRanges()
  const thinking = ui.thinking(Array.from(range.getClientRects()), COPY.thinking)
  const spec: MarkSpec = {
    action,
    transform: 'define',
    text: rewriteFor(range.toString()),
    highStakes
  }
  setTimeout(
    () => {
      thinking.done()
      const mark = renderer.apply(range, spec, { animate: true })
      if (!mark) return
      ui.attach(mark)
      order.push(mark.id)
      ui.announce(announceChange(spec))
      sync()
    },
    Number(params.get('delay') ?? 450)
  )
}

renderer.subscribe((event) => {
  if (event.type === 'dropped') ui.detach(event.mark.id)
  else ui.attach(event.mark)
  sync()
})

document.addEventListener('pointerup', (event) => {
  if (paused || event.composedPath().includes(root.host)) return
  requestAnimationFrame(() => {
    const selection = document.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      ui.hideChip()
      return
    }
    const range = selection.getRangeAt(0)
    if (!renderer.check(range, { action, transform: 'define', text: '' }).ok) return
    pending = range.cloneRange()
    const rects = Array.from(range.getClientRects())
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
    ui.showChip(last)
  })
})

Object.assign(window, { __hootLens: { renderer, ui, root, copy, TRANSFORM_LABEL } })
