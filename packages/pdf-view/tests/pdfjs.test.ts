// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { bodyFontSize, linesFromRuns, reflowPage, runsFromTextContent } from '../src/reflow'

// End to end against real PDF.js output: tests/fixtures/article.pdf comes
// from scripts/gen-fixture.mjs.
const require = createRequire(import.meta.url)
const fonts = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/'

async function reflowFixture(): Promise<ReturnType<typeof reflowPage>> {
  const data = new Uint8Array(await readFile(new URL('./fixtures/article.pdf', import.meta.url)))
  const doc = await getDocument({ data, standardFontDataUrl: fonts }).promise
  try {
    const perPage = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      perPage.push(runsFromTextContent((await page.getTextContent()).items))
    }
    const body = bodyFontSize(perPage.flatMap((r) => linesFromRuns(r)))
    return perPage.flatMap((runs, i) => reflowPage(runs, i + 1, body))
  } finally {
    await doc.loadingTask.destroy()
  }
}

describe('reflow of a real PDF', () => {
  it('recovers the article structure across pages', async () => {
    const blocks = await reflowFixture()
    expect(blocks.map((b) => (b.kind === 'heading' ? `h${b.level}` : 'p'))).toEqual([
      'h2',
      'p',
      'h3',
      'p',
      'p',
      'h3',
      'p',
      'h3',
      'p',
      'p'
    ])
    expect(blocks[0]).toMatchObject({ text: 'Reading Regression Output', page: 1 })
    expect(blocks[3]?.text).toContain('the model shows heteroscedasticity.')
    expect(blocks[3]?.text).toContain('so the confidence intervals')
    expect(blocks[7]).toMatchObject({ kind: 'heading', text: 'When to worry', page: 2 })
  })
})
