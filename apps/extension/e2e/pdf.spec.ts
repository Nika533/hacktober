import { test, type Page } from '@playwright/test'
import { expect, feedbackKinds, launch, lensReady, shutdown, ui, type Harness } from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

async function selectInTextLayer(page: Page, needle: string): Promise<void> {
  await page.locator('.hoot-pdf-text span', { hasText: needle }).first().waitFor()
  await lensReady(page)
  await page.evaluate((text) => {
    const layer = document.querySelector('.hoot-pdf-text')
    const walker = document.createTreeWalker(layer ?? document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(text) ?? -1
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
      return
    }
    throw new Error(`no "${text}" in the text layer`)
  }, needle)
}

test('PDFs open in the Lens viewer, and Ask-first works on the page', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await page.goto(`${fixtures.url}/article.pdf`).catch(() => undefined)
  await page.waitForURL(/viewer\.html\?file=/)
  await expect(page.getByRole('heading', { name: 'article.pdf' })).toBeVisible()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()

  await selectInTextLayer(page, 'heteroscedasticity')
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
  await expect(page.locator('.hoot-pdf-mark mark')).toHaveText(
    'heteroscedasticity (a fake definition)'
  )
  await expect.poll(() => feedbackKinds(harness)).toEqual(['shown'])
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.waitForTimeout(500)
    await page.screenshot({ path: test.info().outputPath(`pdf-viewer-${colorScheme}.png`) })
  }

  await page.getByRole('radiogroup', { name: 'View' }).getByText('Reflow').click()
  await expect(page.locator('.hoot-pdf-reflow')).toBeVisible()
  await expect(page.locator('.hoot-pdf-mark')).toHaveCount(0)
})

// bericht.pdf is German and, like many PDFs, has no /Lang: the viewer's own
// English UI must not make it read as English.
test('a PDF in another language is translated, on the page and in reflow', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await page.goto(`${fixtures.url}/bericht.pdf`).catch(() => undefined)
  await page.waitForURL(/viewer\.html\?file=/)
  await expect(page.getByText('Page 1 of 1')).toBeVisible()

  await selectInTextLayer(page, 'Streuung')
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
  await expect(page.locator('.hoot-pdf-mark mark')).toHaveText('[translated] Streuung')
  await expect.poll(() => feedbackKinds(harness)).toEqual(['shown'])
  expect(harness.server.backend.events[0]).toMatchObject({ transform: 'translate' })

  await page.getByRole('radiogroup', { name: 'View' }).getByText('Reflow').click()
  await expect(page.locator('.hoot-pdf-reflow')).toBeVisible()
  await page.locator('.hoot-pdf-reflow p', { hasText: 'Prognosen' }).first().waitFor()
  await lensReady(page)
  await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector('.hoot-pdf-reflow') ?? document.body,
      NodeFilter.SHOW_TEXT
    )
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf('Prognosen') ?? -1
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 'Prognosen'.length)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
      return
    }
  })
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
  await expect(page.locator('.hoot-pdf-reflow hoot-lens-mark mark')).toHaveText(
    '[translated] Prognosen'
  )
})
