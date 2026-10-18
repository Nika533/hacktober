import type { ChatMessageView, QuickAction } from '../chat/types'

// Fake screen captures for the gallery. These colours are fixture content
// (pretend screenshots), not UI colours, so they don't come from tokens.
function capture(bars: number[], hue: number): string {
  const rects = bars
    .map(
      (h, i) =>
        `<rect x="${12 + i * 22}" y="${100 - h}" width="14" height="${h}" rx="2" fill="hsl(${hue} 70% 55%)"/>`
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110"><rect width="160" height="110" fill="#f4f5f8"/><rect x="8" y="8" width="70" height="8" rx="2" fill="#c8cbd4"/>${rects}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export const CHART = capture([30, 46, 40, 62, 74, 88], 220)
export const TABLE = capture([20, 20, 20, 20, 20, 20], 150)

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'explain', label: 'Explain' },
  { id: 'extract', label: 'Extract text' },
  { id: 'translate', label: 'Translate' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'fix', label: 'Fix' }
]

export const CONVERSATION: ChatMessageView[] = [
  {
    id: 'u1',
    role: 'user',
    text: 'What does this chart show?',
    status: 'done',
    attachments: [{ id: 'c1', thumbUrl: CHART, label: 'Revenue chart capture' }]
  },
  {
    id: 'a1',
    role: 'assistant',
    status: 'done',
    text: [
      'Quarterly revenue, rising every quarter except **Q3**, which dips about 9%.',
      '',
      '| Quarter | Revenue | Change |',
      '|---|---:|---:|',
      '| Q1 | $30k | |',
      '| Q2 | $46k | +53% |',
      '| Q3 | $42k | −9% |',
      '| Q4 | $62k | +48% |',
      '',
      'To reproduce it from a CSV:',
      '',
      '```python',
      'import pandas as pd',
      'df = pd.read_csv("revenue.csv")',
      'df.plot.bar(x="quarter", y="revenue")',
      '```',
      '',
      'Source: [the Gemini API docs](https://ai.google.dev/gemini-api/docs) cover image input.'
    ].join('\n')
  },
  { id: 'u2', role: 'user', text: 'Why the dip in Q3?', status: 'done' },
  {
    id: 'a2',
    role: 'assistant',
    status: 'stopped',
    text: 'The chart alone can’t say. Common causes are seasonality, a delayed launch, or a one-off'
  }
]

export const STREAM_REPLY =
  'Looking at the axis labels, Q3 covers **July to September**. A summer slowdown is the usual reason, but check whether a large invoice moved into Q4: the Q4 jump is bigger than the trend.'
