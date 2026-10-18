import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { UI_TAG } from '../src/guard'
import { InlineRenderer } from '../src/render/inline'
import type { Mark, MarkSpec } from '../src/render/types'
import { LensUi, type LensUiHandlers } from '../src/ui/lens-ui'
import { createUiRoot, type UiRoot } from '../src/ui/root'
import { loadArticle, rangeForText, textNodes } from './helpers'

const wait = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let article: HTMLElement
let root: UiRoot
let renderer: InlineRenderer
let ui: LensUi
const mocks = (): {
  [K in keyof LensUiHandlers]: Mock<LensUiHandlers[K]>
} => ({
  restore: vi.fn<(mark: Mark) => void>((mark) => {
    renderer.restore(mark.id)
  }),
  knewIt: vi.fn<(mark: Mark) => void>(),
  explainMore: vi.fn<(mark: Mark) => void>(),
  copyRewritten: vi.fn<(mark: Mark) => void>(),
  undoLast: vi.fn<() => void>(),
  undoAll: vi.fn<() => void>(),
  togglePause: vi.fn<() => void>(),
  ask: vi.fn<() => void>()
})
let handlers: ReturnType<typeof mocks> & LensUiHandlers

const define: MarkSpec = {
  action: 'replace',
  transform: 'define',
  text: 'heteroscedasticity (unequal spread of errors)'
}

function mount(spec: MarkSpec = define, needle = 'heteroscedasticity'): Mark {
  const mark = renderer.apply(rangeForText(article, needle), spec)!
  ui.attach(mark)
  return mark
}

const dialog = (): HTMLElement => root.shadow.querySelector('[role="dialog"]') as HTMLElement
const button = (action: string): HTMLButtonElement =>
  root.shadow.querySelector(`[data-action="${action}"]`) as HTMLButtonElement
const key = (target: EventTarget, init: KeyboardEventInit): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, ...init }))
}

beforeEach(() => {
  document.documentElement.querySelectorAll(UI_TAG).forEach((node) => node.remove())
  article = loadArticle()
  root = createUiRoot({ document, shadowMode: 'open' })
  renderer = new InlineRenderer({ document, shadowMode: 'open' })
  handlers = mocks()
  ui = new LensUi({
    root,
    handlers,
    animate: false,
    trustedOnly: false,
    openDelayMs: 0,
    closeDelayMs: 0
  })
})

afterEach(() => {
  ui.destroy()
  renderer.destroy()
  root.destroy()
})

describe('popover', () => {
  it('opens on Enter, shows the exact original and focuses Restore', () => {
    const mark = mount()
    key(mark.anchor, { key: 'Enter' })
    expect(dialog().hidden).toBe(false)
    expect(dialog().querySelector('.original')?.textContent).toBe('heteroscedasticity')
    expect(dialog().querySelector('.transform')?.textContent).toBe('Defined a term')
    expect(root.shadow.activeElement).toBe(button('restore'))
  })

  it('restores the page exactly from the Restore button', () => {
    const html = article.innerHTML
    const nodes = textNodes(article)
    const mark = mount()
    ui.popover.show(mark)
    button('restore').click()
    expect(handlers.restore).toHaveBeenCalledWith(mark)
    expect(dialog().hidden).toBe(true)
    expect(article.innerHTML).toBe(html)
    expect(textNodes(article)).toEqual(nodes)
  })

  it.each([
    ['knewIt', 'knewIt'],
    ['explainMore', 'explainMore']
  ] as const)('passes the mark to %s and closes', (action, handler) => {
    const mark = mount()
    ui.popover.show(mark)
    button(action).click()
    expect(handlers[handler]).toHaveBeenCalledWith(mark)
    expect(ui.popover.open).toBe(false)
  })

  it('offers Copy rewritten for replacements and keeps the popover open', () => {
    const mark = mount()
    ui.popover.show(mark)
    button('copyRewritten').click()
    expect(handlers.copyRewritten).toHaveBeenCalledWith(mark)
    expect(button('copyRewritten').textContent).toBe('Copied')
    expect(ui.popover.open).toBe(true)
  })

  it('shows the high-stakes note only on high-stakes changes', () => {
    const plain = mount()
    ui.popover.show(plain)
    expect((dialog().querySelector('.stakes') as HTMLElement).hidden).toBe(true)
    const stakes = mount({ ...define, highStakes: true }, 'standard errors')
    ui.popover.show(stakes)
    expect((dialog().querySelector('.stakes') as HTMLElement).hidden).toBe(false)
    expect(dialog().querySelector('.stakes')?.textContent).toBe(
      'Reading aid — the original wording is what applies.'
    )
  })

  it('labels gloss notes and hides Copy rewritten', () => {
    const mark = mount({ action: 'gloss', transform: 'define', text: 'unequal spread' })
    ui.popover.show(mark)
    expect(dialog().querySelector('.label')?.textContent).toBe('Hoot added')
    expect(dialog().querySelector('.original')?.textContent).toBe('unequal spread')
    expect(button('restore').textContent).toBe('Remove note')
    expect(button('copyRewritten').hidden).toBe(true)
  })

  it('keeps Tab inside the popover and returns focus to the mark on Escape', () => {
    const mark = mount()
    key(mark.anchor, { key: 'Enter' })
    key(button('restore'), { key: 'Tab', shiftKey: true })
    expect(root.shadow.activeElement).toBe(button('copyRewritten'))
    key(button('copyRewritten'), { key: 'Tab' })
    expect(root.shadow.activeElement).toBe(button('restore'))
    key(button('restore'), { key: 'Escape' })
    expect(ui.popover.open).toBe(false)
    expect(mark.anchor.getRootNode()).toBeInstanceOf(ShadowRoot)
    expect((mark.anchor.getRootNode() as ShadowRoot).activeElement).toBe(mark.anchor)
  })

  it('opens on hover and closes after the pointer leaves', async () => {
    const mark = mount()
    mark.anchor.dispatchEvent(new Event('pointerenter'))
    await wait(5)
    expect(ui.popover.mark).toBe(mark)
    mark.anchor.dispatchEvent(new Event('pointerleave'))
    dialog().dispatchEvent(new Event('pointerenter'))
    await wait(5)
    expect(ui.popover.open).toBe(true)
    dialog().dispatchEvent(new Event('pointerleave'))
    await wait(5)
    expect(ui.popover.open).toBe(false)
  })

  it('closes when its mark is detached', () => {
    const mark = mount()
    ui.popover.show(mark)
    ui.detach(mark.id)
    expect(ui.popover.open).toBe(false)
  })
})

describe('keyboard map', () => {
  it.each([
    [{ key: 'z', code: 'KeyZ', altKey: true }, 'undoLast'],
    [{ key: 'Z', code: 'KeyZ', altKey: true, shiftKey: true }, 'undoAll'],
    [{ key: 'h', code: 'KeyH', altKey: true }, 'togglePause']
  ] as const)('maps %o to %s', (init, handler) => {
    key(document.body, init)
    expect(handlers[handler]).toHaveBeenCalledOnce()
  })

  it('uses the physical key so layouts and Option-characters still work', () => {
    key(document.body, { key: 'Ω', code: 'KeyZ', altKey: true })
    expect(handlers.undoLast).toHaveBeenCalledOnce()
  })

  it('only asks from the keyboard while the chip is visible', () => {
    key(document.body, { key: 'l', code: 'KeyL', altKey: true })
    expect(handlers.ask).not.toHaveBeenCalled()
    ui.showChip({ left: 10, top: 10, width: 40, height: 20 })
    key(document.body, { key: 'l', code: 'KeyL', altKey: true })
    expect(handlers.ask).toHaveBeenCalledOnce()
  })

  it('ignores shortcuts while typing and with Ctrl', () => {
    const input = document.createElement('input')
    document.body.append(input)
    key(input, { key: 'z', code: 'KeyZ', altKey: true })
    key(document.body, { key: 'z', code: 'KeyZ', altKey: true, ctrlKey: true })
    expect(handlers.undoLast).not.toHaveBeenCalled()
  })

  it('ignores synthetic events when trustedOnly is on', () => {
    ui.destroy()
    ui = new LensUi({ root, handlers, animate: false })
    key(document.body, { key: 'h', code: 'KeyH', altKey: true })
    expect(handlers.togglePause).not.toHaveBeenCalled()
  })
})

describe('page pill', () => {
  const pill = (): HTMLElement => root.shadow.querySelector('.pill') as HTMLElement

  it('appears after the first change and counts changes', () => {
    expect(pill().hidden).toBe(true)
    ui.setCount(1)
    expect(pill().hidden).toBe(false)
    expect(pill().querySelector('.status')?.textContent).toBe('Hoot changed 1 thing')
    ui.setCount(3)
    expect(pill().querySelector('.status')?.textContent).toBe('Hoot changed 3 things')
    ui.setCount(0)
    expect(pill().hidden).toBe(true)
  })

  it('wires Undo all and Pause, and shows the paused state', () => {
    ui.setCount(2)
    button('undo-all').click()
    button('pause').click()
    expect(handlers.undoAll).toHaveBeenCalledOnce()
    expect(handlers.togglePause).toHaveBeenCalledOnce()
    ui.setCount(0, true)
    expect(pill().hidden).toBe(false)
    expect(pill().querySelector('.status')?.textContent).toBe('Lens is paused on this site')
    expect(button('pause').textContent).toBe('Resume')
    expect(button('undo-all').hidden).toBe(true)
  })

  it('talks about local files, not “this site”, for a file (#81)', () => {
    ui.destroy()
    root.destroy()
    root = createUiRoot({ document, shadowMode: 'open' })
    ui = new LensUi({ root, handlers, animate: false, trustedOnly: false, localFiles: true })
    ui.setCount(1)
    expect(button('pause').textContent).toBe('Pause for local files')
    ui.setCount(0, true)
    expect(pill().querySelector('.status')?.textContent).toBe('Lens is paused for local files')
    expect(button('pause').textContent).toBe('Resume')
  })
})

describe('Ask-first chip and thinking state', () => {
  it('shows near the selection, keeps the selection on press, and asks on click', () => {
    ui.showChip({ left: 100, top: 100, width: 50, height: 20 })
    const chip = button('ask')
    expect(chip.hidden).toBe(false)
    expect(chip.textContent).toBe('Make this clearer?')
    expect(chip.getAttribute('aria-keyshortcuts')).toBe('Alt+L')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    chip.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    chip.click()
    expect(handlers.ask).toHaveBeenCalledOnce()
    key(document.body, { key: 'Escape' })
    expect(ui.chip.visible).toBe(false)
  })

  it('shimmers only the selected span and announces the work', async () => {
    const rect = { left: 10, top: 20, width: 80, height: 18 } as DOMRect
    const handle = ui.thinking(
      [rect, { ...rect, width: 0 } as DOMRect],
      'Hoot is making this clearer…'
    )
    const boxes = root.shadow.querySelectorAll('.shimmer')
    expect(boxes).toHaveLength(1)
    expect((boxes[0] as HTMLElement).style.width).toBe('80px')
    await wait()
    expect(root.shadow.querySelector('[role="status"].sr-only')?.textContent).toBe(
      'Hoot is making this clearer…'
    )
    handle.done()
    expect(root.shadow.querySelectorAll('.shimmer')).toHaveLength(0)
  })
})
