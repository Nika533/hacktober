import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const mounted = new Set<Root>()

export interface Rendered {
  container: HTMLElement
  rerender: (ui: ReactNode) => void
}

export function render(ui: ReactNode): Rendered {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.add(root)
  act(() => root.render(ui))
  return { container, rerender: (next) => act(() => root.render(next)) }
}

export function cleanup(): void {
  for (const root of mounted) act(() => root.unmount())
  mounted.clear()
}

export function click(el: Element | null): void {
  if (!(el instanceof HTMLElement)) throw new Error('click(): no element')
  act(() => el.click())
}

export function key(el: Element | Document, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

export async function wait(ms: number): Promise<void> {
  await act(() => new Promise<void>((r) => setTimeout(r, ms)))
}

/** Finds the first element whose accessible name (aria-label or text) matches. */
export function byName<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
  name: string
): T {
  const hit = [...root.querySelectorAll<T>(selector)].find(
    (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === name
  )
  if (!hit) throw new Error(`no ${selector} named "${name}"`)
  return hit
}
