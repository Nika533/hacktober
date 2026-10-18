import { describe, expect, it } from 'vitest'
import { DynamicPageDetector, frameworkMarkers, isDynamic } from '../src/render/detect'

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

describe('dynamic page detection', () => {
  it('finds framework root markers', () => {
    document.body.innerHTML =
      '<div id="__next"><div data-reactroot></div></div><div id="app"></div>'
    expect(frameworkMarkers(document)).toEqual({
      strong: ['[data-reactroot]', '#__next'],
      weak: ['#app']
    })
  })

  it('decides from markers and mutation rate', () => {
    expect(isDynamic({ strong: ['#__nuxt'], weak: [], mutationsPerSecond: 0 })).toBe(true)
    expect(isDynamic({ strong: [], weak: [], mutationsPerSecond: 0.5 })).toBe(false)
    expect(isDynamic({ strong: [], weak: [], mutationsPerSecond: 12 })).toBe(true)
    expect(isDynamic({ strong: [], weak: ['#root'], mutationsPerSecond: 0 })).toBe(false)
    expect(isDynamic({ strong: [], weak: ['#root'], mutationsPerSecond: 0.3 })).toBe(true)
  })

  it('counts page mutations during the first seconds, ignoring Lens elements', async () => {
    document.body.innerHTML = '<p id="p">static</p>'
    let now = 0
    const detector = new DynamicPageDetector({ document, windowMs: 3000, now: () => now })
    detector.start()
    const mark = document.createElement('hoot-lens-mark')
    document.body.append(mark)
    mark.textContent = 'ours'
    await settle()
    expect(detector.dynamic).toBe(false)
    for (let i = 0; i < 30; i++) document.getElementById('p')!.textContent = `tick ${i}`
    await settle()
    now = 3000
    document.getElementById('p')!.textContent = 'last'
    await settle()
    expect(detector.signals().mutationsPerSecond).toBeGreaterThanOrEqual(8)
    expect(detector.dynamic).toBe(true)
  })

  it('can be forced into dynamic mode after repeated drops', () => {
    document.body.innerHTML = '<p>static</p>'
    const detector = new DynamicPageDetector({ document })
    expect(detector.dynamic).toBe(false)
    detector.markDynamic()
    expect(detector.dynamic).toBe(true)
  })
})
