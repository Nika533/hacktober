import { describe, expect, it } from 'vitest'
import {
  boundsToScreen,
  chatPlacement,
  hitsTarget,
  MAX_ANNOTATIONS,
  parseAnnotations,
  TARGET_HIT_DIP,
  toScreen
} from '../../src/renderer/capture/annotations'

describe('parseAnnotations', () => {
  it('pulls point, box and action tags out of the answer', () => {
    const { text, annotations } = parseAnnotations(
      [
        'Click **Save** in the top bar.',
        '[[point: 120, 40, "Save"]]',
        'The chart is here:',
        '[[box: 600, 300, 200, 800, "Sales chart"]]',
        '[[action: 950, 20, “Close the dialog”]]'
      ].join('\n')
    )
    expect(text).toBe('Click **Save** in the top bar.\nThe chart is here:')
    expect(annotations).toEqual([
      { kind: 'point', x: 120, y: 40, label: 'Save' },
      // Corners normalized, whatever order they came in.
      { kind: 'box', x1: 200, y1: 300, x2: 600, y2: 800, label: 'Sales chart' },
      { kind: 'action', x: 950, y: 20, label: 'Close the dialog' }
    ])
  })

  it('clamps coordinates, tolerates spacing and case, and drops malformed tags', () => {
    const { text, annotations } = parseAnnotations(
      'See [[ POINT : 1200 , -5 , "Edge" ]] and [[point: 5]] and [[box: 1, 2, 3, "Bad"]].'
    )
    expect(annotations).toEqual([{ kind: 'point', x: 1000, y: 0, label: 'Edge' }])
    expect(text).toBe('See  and  and .')
  })

  it('keeps apostrophes in labels and takes tags out of backticks and code blocks', () => {
    const { text, annotations } = parseAnnotations(
      'Press `[[point: 10, 20, "Don\'t save"]]` now.\n```\n[[box: 1, 2, 3, 4, "Area"]]\n```\nDone.'
    )
    expect(annotations.map((a) => a.label)).toEqual(["Don't save", 'Area'])
    expect(text).toBe('Press  now.\n\nDone.')
  })

  it('only hides a half-arrived tag while streaming, and only on the last line', () => {
    expect(parseAnnotations('Click here [[point: 12', true).text).toBe('Click here')
    // A finished answer keeps a literal "[[" that isn't a tag.
    expect(parseAnnotations('Arrays look like [[1, 2', false).text).toBe('Arrays look like [[1, 2')
    expect(parseAnnotations('a [[b\nc', true).text).toBe('a [[b\nc')
  })

  it('takes a control’s edges for a step or a point: the box to highlight, its centre to click', () => {
    const { annotations } = parseAnnotations(
      [
        '[[action: 600, 80, 500, 40, "Save"]]',
        '[[point: 100, 200, 140, 220, "Search"]]',
        // A "box" with no width is just a spot.
        '[[action: 300, 300, 300, 340, "Flat"]]'
      ].join('\n')
    )
    expect(annotations).toEqual([
      {
        kind: 'action',
        x: 550,
        y: 60,
        label: 'Save',
        bounds: { x1: 500, y1: 40, x2: 600, y2: 80 }
      },
      {
        kind: 'point',
        x: 120,
        y: 210,
        label: 'Search',
        bounds: { x1: 100, y1: 200, x2: 140, y2: 220 }
      },
      { kind: 'action', x: 300, y: 320, label: 'Flat' }
    ])
    expect(annotations[2]).not.toHaveProperty('bounds')
  })

  it('caps how many marks show', () => {
    const many = Array.from({ length: 12 }, (_, i) => `[[point: ${i}, ${i}, "p${i}"]]`).join('\n')
    expect(parseAnnotations(many).annotations).toHaveLength(MAX_ANNOTATIONS)
  })
})

describe('toScreen', () => {
  it('maps 0–1000 onto the display', () => {
    expect(toScreen({ x: 500, y: 250 }, { width: 1920, height: 1080 })).toEqual({ x: 960, y: 270 })
    expect(
      boundsToScreen({ x1: 500, y1: 250, x2: 750, y2: 500 }, { width: 1920, height: 1080 })
    ).toEqual({ x: 960, y: 270, width: 480, height: 270 })
  })
})

describe('hitsTarget', () => {
  it('counts a click inside a highlight box (with a little slack), or near the centre', () => {
    const target = { at: { x: 500, y: 300 }, rect: { x: 300, y: 280, width: 400, height: 40 } }
    // Far from the centre, but on the box.
    expect(hitsTarget({ x: 310, y: 300 }, target)).toBe(true)
    expect(hitsTarget({ x: 295, y: 325 }, target)).toBe(true)
    expect(hitsTarget({ x: 200, y: 300 }, target)).toBe(false)
  })

  it('a spot without a box hits within TARGET_HIT_DIP of it', () => {
    const target = { at: { x: 500, y: 300 } }
    expect(hitsTarget({ x: 500 + TARGET_HIT_DIP - 1, y: 300 }, target)).toBe(true)
    expect(hitsTarget({ x: 500 + TARGET_HIT_DIP + 1, y: 300 }, target)).toBe(false)
  })
})

describe('chatPlacement', () => {
  const view = { width: 1920, height: 1080 }
  const box = { width: 380, height: 440 }
  const overlaps = (
    p: { x: number; y: number },
    r: { x: number; y: number; width: number; height: number }
  ): boolean =>
    p.x < r.x + r.width && r.x < p.x + box.width && p.y < r.y + r.height && r.y < p.y + box.height

  it('goes right of the shape when there is room, aligned to its top', () => {
    expect(chatPlacement({ x: 100, y: 200, width: 300, height: 200 }, view, box)).toEqual({
      x: 416,
      y: 200
    })
  })

  it('falls back to the left, then below, never covering the shape', () => {
    const nearRight = { x: 1500, y: 300, width: 380, height: 200 }
    const left = chatPlacement(nearRight, view, box)
    expect(left.x).toBe(1500 - 16 - 380)
    expect(overlaps(left, nearRight)).toBe(false)

    const wide = { x: 40, y: 100, width: 1840, height: 300 }
    const below = chatPlacement(wide, view, box)
    expect(below.y).toBe(416)
    expect(overlaps(below, wide)).toBe(false)
  })

  it('stays on screen for a shape that fills it', () => {
    const p = chatPlacement({ x: 0, y: 0, width: 1920, height: 1080 }, view, box)
    expect(p.x).toBeGreaterThanOrEqual(16)
    expect(p.y).toBeGreaterThanOrEqual(16)
    expect(p.x + box.width).toBeLessThanOrEqual(view.width - 16)
    expect(p.y + box.height).toBeLessThanOrEqual(view.height - 16)
  })
})
