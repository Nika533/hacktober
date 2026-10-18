import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEPT_AFTER_MS, KeptTracker } from '../src/kept'
import type { Mark } from '../src/render/types'

type Box = { top: number; bottom: number } | null

const ON_SCREEN: Box = { top: 100, bottom: 120 }
const BELOW: Box = { top: 5000, bottom: 5020 }
const ABOVE: Box = { top: -400, bottom: -380 }

function fakeMark(id: string, initial: Box): { mark: Mark; move: (box: Box) => void } {
  let box = initial
  const anchor = document.createElement('span')
  document.body.append(anchor)
  const mark: Mark = {
    id,
    spec: { action: 'replace', transform: 'define', text: 'x' },
    original: 'o',
    anchor,
    rects: () => (box ? [new DOMRect(10, box.top, 80, box.bottom - box.top)] : [])
  }
  return { mark, move: (next) => (box = next) }
}

let kept: string[]
let tracker: KeptTracker

beforeEach(() => {
  vi.useFakeTimers()
  kept = []
  tracker = new KeptTracker({ document, onKept: (id) => kept.push(id) })
})

afterEach(() => {
  tracker.destroy()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('KeptTracker', () => {
  it('reports a change that stayed on screen for 30 s, once', () => {
    tracker.track(fakeMark('a', ON_SCREEN).mark)
    vi.advanceTimersByTime(KEPT_AFTER_MS - 1_000)
    expect(kept).toEqual([])
    vi.advanceTimersByTime(1_000)
    expect(kept).toEqual(['a'])
    vi.advanceTimersByTime(KEPT_AFTER_MS)
    expect(kept).toEqual(['a'])
    expect(tracker.size).toBe(0)
  })

  it('reports a change the reader scrolled past, once 30 s have passed', () => {
    const { mark, move } = fakeMark('a', ON_SCREEN)
    tracker.track(mark)
    vi.advanceTimersByTime(3_000)
    move(ABOVE)
    vi.advanceTimersByTime(20_000)
    expect(kept).toEqual([])
    vi.advanceTimersByTime(7_000)
    expect(kept).toEqual(['a'])
  })

  it('waits until a change below the fold has been on screen for 30 s', () => {
    const { mark, move } = fakeMark('a', BELOW)
    tracker.track(mark)
    vi.advanceTimersByTime(60_000)
    expect(kept).toEqual([])
    move(ON_SCREEN)
    vi.advanceTimersByTime(29_000)
    expect(kept).toEqual([])
    vi.advanceTimersByTime(1_000)
    expect(kept).toEqual(['a'])
  })

  it('does not count time while the tab is hidden', () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    tracker.track(fakeMark('a', ON_SCREEN).mark)
    vi.advanceTimersByTime(60_000)
    expect(kept).toEqual([])
    state.mockReturnValue('visible')
    vi.advanceTimersByTime(30_000)
    expect(kept).toEqual(['a'])
  })

  it('never reports a change that was restored', () => {
    tracker.track(fakeMark('a', ON_SCREEN).mark)
    vi.advanceTimersByTime(10_000)
    tracker.forget('a')
    vi.advanceTimersByTime(60_000)
    expect(kept).toEqual([])
  })

  it('keeps the history when the page re-renders a change', () => {
    const first = fakeMark('a', ON_SCREEN)
    tracker.track(first.mark)
    vi.advanceTimersByTime(20_000)
    first.mark.anchor.remove()
    vi.advanceTimersByTime(2_000)
    tracker.replace('a', fakeMark('b', ON_SCREEN).mark)
    vi.advanceTimersByTime(9_000)
    expect(kept).toEqual([])
    vi.advanceTimersByTime(1_000)
    expect(kept).toEqual(['b'])
  })

  it('lets go of a change the page removed for good', () => {
    const { mark } = fakeMark('a', ON_SCREEN)
    tracker.track(mark)
    mark.anchor.remove()
    vi.advanceTimersByTime(KEPT_AFTER_MS)
    expect(tracker.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(kept).toEqual([])
  })
})
