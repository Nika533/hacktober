import type { BuddyMode, BuddyTransition, HootApi, ModeLayout, Rect } from '@hoot/core'
import { layoutForMode } from '@hoot/core'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Buddy } from '../src/buddy/Buddy'
import { capsuleRect, isGrow, layoutFits, measureHitRegions } from '../src/buddy/geometry'
import { ACK_FALLBACK_MS, useBuddyTransitions } from '../src/buddy/useBuddyTransitions'
import { createFakeBuddyMain, type FakeBuddyMain } from '../src/gallery/fakeBuddyMain'
import { useHootState } from '../src/state/useHootState'
import { byName, click, key, render, wait } from './render'

const WA: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const ANCHOR = { x: 1880, y: 1040 }
const SLICES = ['buddy', 'chat'] as const
/**
 * Longer than any spring here (0.35 s). In short steps: React flushes
 * updates only when each act() ends, and the choreography needs renders.
 */
async function settle(ms = 700): Promise<void> {
  for (let t = 0; t < ms; t += 50) await wait(50)
}

function Harness({ main }: { main: FakeBuddyMain }): React.JSX.Element | null {
  const { state } = useHootState(main.hoot as unknown as HootApi, SLICES)
  if (!state?.buddy || !state.chat) return null
  return (
    <Buddy
      host={main.hoot}
      buddy={state.buddy}
      chat={state.chat}
      captureHotkey="Control+Alt+Space"
    />
  )
}

let mains: FakeBuddyMain[] = []
afterEach(() => {
  for (const m of mains) m.dispose()
  mains = []
})

async function mount(mode: BuddyMode = 'dot'): Promise<{ main: FakeBuddyMain; root: HTMLElement }> {
  const main = createFakeBuddyMain({ workArea: WA, anchor: ANCHOR, mode, streamMs: 5 })
  mains.push(main)
  const { container } = render(<Harness main={main} />)
  await wait(0)
  return { main, root: container }
}

describe('buddy geometry', () => {
  it('orders modes and recognises a layout by its window size', () => {
    expect(isGrow('dot', 'card')).toBe(true)
    expect(isGrow('card', 'pill')).toBe(false)
    expect(isGrow('pill', 'hidden')).toBe(false)
    const pill = layoutForMode('pill', ANCHOR, WA)
    expect(layoutFits('pill', pill)).toBe(true)
    expect(layoutFits('card', pill)).toBe(false)
    expect(layoutFits('pill', null)).toBe(false)
    // d1's window is one card-sized canvas for every mode.
    const canvas = layoutForMode('card', ANCHOR, WA)
    expect(layoutFits('pill', canvas)).toBe(true)
    expect(layoutFits('dot', canvas)).toBe(true)
  })

  it('puts the capsule around the owl at the anchor-side end', () => {
    const right = layoutForMode('pill', ANCHOR, WA) // owl on the right, opens left
    const r = capsuleRect(right)
    expect(r.x + r.width).toBe(right.owl.x + 28 + 4)
    expect(r.y).toBe(right.owl.y - 32)
    const left = layoutForMode('pill', { x: 40, y: 40 }, WA)
    expect(capsuleRect(left).x).toBe(left.owl.x - 32)
  })

  it('measures [data-hit] rects relative to the root, rounded outward', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span data-hit></span><span data-hit></span><span></span>'
    const [a, b, c] = [...root.children] as HTMLElement[]
    const box = (l: number, t: number, w: number, h: number) => () =>
      ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }) as DOMRect
    root.getBoundingClientRect = box(100, 50, 400, 600)
    a!.getBoundingClientRect = box(110.4, 60.6, 56, 56)
    b!.getBoundingClientRect = box(0, 0, 0, 0) // not laid out: skipped
    c!.getBoundingClientRect = box(120, 70, 10, 10) // no data-hit
    expect(measureHitRegions(root)).toEqual([{ x: 10, y: 10, width: 57, height: 57 }])
  })
})

describe('buddy transitions', () => {
  it('grows: main resizes, the pill animates in, then the transition is acked', async () => {
    const { main, root } = await mount('dot')
    expect(root.querySelector('.hoot-buddy-owl')).not.toBeNull()
    act(() => main.requestMode('pill'))
    expect(main.unacked()).toHaveLength(1)
    expect(root.querySelector('[role="toolbar"]')).not.toBeNull()
    await settle()
    expect(main.unacked()).toEqual([])
  })

  it('shrinks: the card animates out first, and main resizes only after the ack', async () => {
    const { main, root } = await mount('card')
    expect(root.querySelector('.hoot-buddy-card')).not.toBeNull()
    act(() => main.requestMode('dot'))
    // Still the card window while the card leaves.
    expect(main.unacked()).toHaveLength(1)
    await settle()
    expect(main.unacked()).toEqual([])
    expect(root.querySelector('.hoot-buddy-card')).toBeNull()
    expect(root.querySelector('.hoot-buddy')?.getAttribute('data-mode')).toBe('dot')
  })

  it('hides the owl itself on the way to hidden', async () => {
    const { main, root } = await mount('dot')
    act(() => main.requestMode('hidden'))
    await settle()
    expect(main.unacked()).toEqual([])
    expect(root.querySelector('.hoot-buddy-owl')).toBeNull()
  })
})

describe('useBuddyTransitions', () => {
  function driver(): {
    d: Parameters<typeof useBuddyTransitions>[0]
    emit: (t: BuddyTransition) => void
    done: ReturnType<typeof vi.fn>
  } {
    let cb: ((t: BuddyTransition) => void) | undefined
    const done = vi.fn()
    return {
      d: {
        onTransition: (fn) => {
          cb = fn
          return () => (cb = undefined)
        },
        transitionDone: done
      },
      emit: (t) => act(() => cb?.(t)),
      done
    }
  }

  function Probe(props: {
    d: Parameters<typeof useBuddyTransitions>[0]
    mode: BuddyMode
    layout: ModeLayout | null
  }): React.JSX.Element {
    const t = useBuddyTransitions(props.d, props.mode, props.layout)
    return <p data-mode={t.mode} data-surface={t.surface ?? ''} data-owl={t.owlVisible} />
  }

  it('acks a transition to where it already is straight away', () => {
    const { d, emit, done } = driver()
    render(<Probe d={d} mode="dot" layout={layoutForMode('dot', ANCHOR, WA)} />)
    emit({ id: 7, from: 'dot', to: 'dot' })
    expect(done).toHaveBeenCalledWith(7)
  })

  it('acks anyway when nothing ever animates (no layout, occluded window)', async () => {
    const { d, emit, done } = driver()
    render(<Probe d={d} mode="hidden" layout={null} />)
    emit({ id: 1, from: 'hidden', to: 'card' })
    await wait(ACK_FALLBACK_MS - 200)
    expect(done).not.toHaveBeenCalled()
    await wait(300)
    expect(done).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('acks only the latest of two overlapping transitions', async () => {
    const { d, emit, done } = driver()
    render(<Probe d={d} mode="hidden" layout={null} />)
    emit({ id: 1, from: 'hidden', to: 'pill' })
    emit({ id: 2, from: 'pill', to: 'card' })
    await wait(ACK_FALLBACK_MS + 100)
    expect(done).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('mounts at once on a fixed card-sized canvas (d1’s window)', () => {
    const { d, emit } = driver()
    const canvas = layoutForMode('card', ANCHOR, WA)
    const { container } = render(<Probe d={d} mode="dot" layout={canvas} />)
    emit({ id: 1, from: 'dot', to: 'pill' })
    expect(container.querySelector('p')?.dataset.surface).toBe('pill')
  })

  it('waits for main’s layout before mounting a bigger surface', async () => {
    const { d, emit } = driver()
    const pill = layoutForMode('pill', ANCHOR, WA)
    const { container, rerender } = render(<Probe d={d} mode="pill" layout={pill} />)
    const p = (): HTMLElement => container.querySelector('p')!
    expect(p().dataset.surface).toBe('pill')
    emit({ id: 1, from: 'pill', to: 'card' })
    expect(p().dataset.mode).toBe('card')
    expect(p().dataset.surface).toBe('')
    rerender(<Probe d={d} mode="card" layout={layoutForMode('card', ANCHOR, WA)} />)
    expect(p().dataset.surface).toBe('card')
  })
})

describe('buddy interactions', () => {
  it('opens the pill from the dot, and the card from the pill', async () => {
    const { main, root } = await mount('dot')
    const spy = vi.spyOn(main.hoot.buddy, 'requestMode')
    click(root.querySelector('.hoot-buddy-owl'))
    expect(spy).toHaveBeenLastCalledWith('pill')
    await settle()
    click(byName(root, 'button', 'Chat'))
    expect(spy).toHaveBeenLastCalledWith('card')
  })

  it('treats a press that moves past the threshold as a drag, not a click', async () => {
    const { main, root } = await mount('dot')
    const b = main.hoot.buddy
    const start = vi.spyOn(b, 'dragStart')
    const end = vi.spyOn(b, 'dragEnd')
    const mode = vi.spyOn(b, 'requestMode')
    const owl = root.querySelector('.hoot-buddy-owl')!
    const ptr = (type: string, x: number): void => {
      act(() => {
        owl.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            screenX: x,
            screenY: 500
          })
        )
      })
    }
    ptr('pointerdown', 100)
    ptr('pointermove', 103)
    expect(start).not.toHaveBeenCalled()
    ptr('pointermove', 140)
    expect(start).toHaveBeenCalledOnce()
    ptr('pointerup', 160)
    expect(end).toHaveBeenCalledOnce()
    expect(end.mock.calls[0]![0].vx).toBeGreaterThan(0)
    click(owl)
    expect(mode).not.toHaveBeenCalled()
  })

  it('Esc stops a streaming answer first, then closes the card', async () => {
    const main = createFakeBuddyMain({ workArea: WA, anchor: ANCHOR, mode: 'card', streamMs: 1000 })
    mains.push(main)
    render(<Harness main={main} />)
    await wait(0)
    const stop = vi.spyOn(main.hoot.chat, 'stop')
    const mode = vi.spyOn(main.hoot.buddy, 'requestMode')
    await act(() => main.hoot.chat.send({ text: 'Hi' }))
    key(document, 'Escape')
    expect(stop).toHaveBeenCalledOnce()
    expect(mode).not.toHaveBeenCalled()
    key(document, 'Escape')
    expect(mode).toHaveBeenCalledWith('pill')
  })

  it('typing on the pill opens the card with the composer seeded', async () => {
    const { main, root } = await mount('pill')
    key(document, 'w')
    await settle()
    expect(main.unacked()).toEqual([])
    const box = root.querySelector<HTMLTextAreaElement>('textarea')
    expect(box?.value).toBe('w')
  })

  it('a greeting with an action arms the clipboard and opens the card', async () => {
    const { main, root } = await mount('dot')
    const arm = vi.spyOn(main.hoot.clipboard, 'arm')
    act(() =>
      main.greet({
        title: 'Good evening',
        subtitle: 'Explain what you copied?',
        action: 'clipboard'
      })
    )
    await settle()
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      'Good evening. Explain what you copied?'
    )
    click(root.querySelector('.hoot-buddy-greeting'))
    expect(arm).toHaveBeenCalledOnce()
    await settle()
    expect(root.querySelector('.hoot-buddy-card')).not.toBeNull()
  })

  it('shows the answer-ready badge on the dot and names it', async () => {
    const { main, root } = await mount('dot')
    await act(() => main.hoot.chat.send({ text: 'Summarize this' }))
    await settle(1500)
    const owl = root.querySelector('.hoot-buddy-owl')
    expect(owl?.querySelector('.hoot-buddy-owl__badge')).not.toBeNull()
    expect(owl?.getAttribute('aria-label')).toBe('Open Hoot, an answer is ready')
  })
})
