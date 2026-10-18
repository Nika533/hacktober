import { describe, expect, it } from 'vitest'
import {
  bodyFontSize,
  joinLines,
  linesFromRuns,
  reflowPage,
  runsFromTextContent,
  type TextRun
} from '../src/reflow'

/** A run of `str` at (x, y) in a font of `size`, ~0.5em per character wide. */
const run = (str: string, x: number, y: number, size = 11): TextRun => ({
  str,
  x,
  y,
  fontSize: size,
  width: str.length * size * 0.5
})

describe('linesFromRuns', () => {
  it('joins runs on one baseline, adding a space only across a gap', () => {
    const lines = linesFromRuns([
      run('Robust', 72, 700),
      run('standard', 72 + 6 * 5.5 + 3, 700),
      run('errors', 72 + 6 * 5.5 + 3 + 8 * 5.5, 700.4), // touching, tiny baseline jitter
      run('Next line', 72, 686)
    ])
    expect(lines.map((l) => l.text)).toEqual(['Robust standarderrors', 'Next line'])
  })

  it('skips empty runs and collapses whitespace', () => {
    const lines = linesFromRuns([run('', 72, 700), run('  two   spaces ', 72, 700)])
    expect(lines.map((l) => l.text)).toEqual(['two spaces'])
  })
})

describe('joinLines', () => {
  it('undoes a line-end hyphen inside a word only', () => {
    expect(joinLines('the confi-', 'dence interval')).toBe('the confidence interval')
    expect(joinLines('see Q3-', 'Q4')).toBe('see Q3- Q4')
    expect(joinLines('state-of-the-', 'Art')).toBe('state-of-the- Art')
    expect(joinLines('one', 'two')).toBe('one two')
  })
})

describe('bodyFontSize', () => {
  it('picks the size carrying the most characters', () => {
    const lines = linesFromRuns([
      run('A big title here', 72, 720, 24),
      run('Body text that goes on for a while longer than the title', 72, 690),
      run('More body text', 72, 676)
    ])
    expect(bodyFontSize(lines)).toBe(11)
  })
})

describe('reflowPage', () => {
  it('builds headings and paragraphs, rejoining wrapped and hyphenated lines', () => {
    const blocks = reflowPage(
      [
        run('Reading Regression Output', 72, 720, 24),
        run('What the residuals tell you', 72, 650, 16),
        run('When the spread grows, the model shows', 72, 625),
        run('heteroscedasticity, so the confi-', 72, 611),
        run('dence intervals are wrong.', 72, 597),
        run('A residual plot is the quickest check.', 72, 569),
        run('Body text sets the body size so headings stand out.', 72, 555)
      ],
      1
    )
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, text: 'Reading Regression Output', page: 1 },
      { kind: 'heading', level: 3, text: 'What the residuals tell you', page: 1 },
      {
        kind: 'paragraph',
        text: 'When the spread grows, the model shows heteroscedasticity, so the confidence intervals are wrong.',
        page: 1
      },
      {
        kind: 'paragraph',
        text: 'A residual plot is the quickest check. Body text sets the body size so headings stand out.',
        page: 1
      }
    ])
  })

  it('breaks blocks on a large gap or a font change, and keeps stream order for columns', () => {
    const blocks = reflowPage(
      [
        run('Left column line one', 72, 700),
        run('left column line two', 72, 686),
        // The stream continues at the top of the right column: a jump up.
        run('Right column line one', 320, 700),
        run('right column line two', 320, 686),
        run('Footnote in small type', 72, 100, 8)
      ],
      3,
      11
    )
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['paragraph', 'Left column line one left column line two'],
      ['paragraph', 'Right column line one right column line two'],
      ['paragraph', 'Footnote in small type']
    ])
    expect(blocks.every((b) => b.page === 3)).toBe(true)
  })

  it('does not call a long large-type passage a heading', () => {
    const long = 'x'.repeat(240)
    expect(reflowPage([run(long, 72, 700, 18)], 1, 11)[0]?.kind).toBe('paragraph')
  })
})

describe('runsFromTextContent', () => {
  it('maps PDF.js items and skips marked-content entries', () => {
    const runs = runsFromTextContent([
      { str: 'Hello', transform: [11, 0, 0, 11, 72, 700], width: 25, height: 11 },
      { type: 'beginMarkedContent', id: '' },
      { str: 'Scaled', transform: [0, 12, -12, 0, 100, 600], width: 30, height: 12 }
    ])
    expect(runs).toEqual([
      { str: 'Hello', x: 72, y: 700, width: 25, fontSize: 11 },
      { str: 'Scaled', x: 100, y: 600, width: 30, fontSize: 12 }
    ])
  })
})
