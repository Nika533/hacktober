import { describe, expect, it } from 'vitest'
import { springEasing, stepSpring } from '../../src/renderer/capture/motion'

describe('stepSpring (critically damped)', () => {
  it('settles on the target without overshooting, at any frame rate', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 20]) {
      const a = { value: 0, velocity: 0, target: 100 }
      let max = 0
      let steps = 0
      while (!stepSpring(a, dt) && steps < 1000) {
        max = Math.max(max, a.value)
        steps++
      }
      expect(a.value).toBe(100)
      expect(a.velocity).toBe(0)
      expect(max).toBeLessThanOrEqual(100)
      // ~0.35 s response: settled well within a second.
      expect(steps * dt).toBeLessThan(1)
    }
  })

  it('a new target mid-flight keeps the current value and velocity (no jump)', () => {
    const a = { value: 0, velocity: 0, target: 100 }
    for (let i = 0; i < 6; i++) stepSpring(a, 1 / 60)
    const { value, velocity } = a
    expect(velocity).toBeGreaterThan(0)
    a.target = 0
    stepSpring(a, 1 / 60)
    // One frame later it's still near where it was, turning around smoothly.
    expect(Math.abs(a.value - value)).toBeLessThan(velocity / 60 + 1)
  })
})

describe('springEasing', () => {
  it('is a CSS linear() curve from 0 to 1 that only rises', () => {
    const easing = springEasing(460, 0.32)
    expect(easing.startsWith('linear(')).toBe(true)
    const points = easing.slice(7, -1).split(', ').map(Number)
    expect(points[0]).toBe(0)
    expect(points.at(-1)).toBe(1)
    for (let i = 1; i < points.length; i++)
      expect(points[i]!).toBeGreaterThanOrEqual(points[i - 1]!)
  })
})
