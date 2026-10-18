/// <reference lib="dom" />
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { dropProfile, expectAxeClean, hook, launch, newProfile, studioPage } from './studio-app'

/**
 * Hoot Reader on the real app: a local PDF in pdf-view with Lens over IPC.
 * Ask-first on a hard word gets the fake Lens's rewrite as an overlay mark.
 */

const FIXTURE = join(__dirname, '../../../packages/pdf-view/tests/fixtures/article.pdf')

let app: ElectronApplication
let profile: string

test.beforeEach(async () => {
  profile = newProfile()
  app = await launch(profile)
  await hook(app, 'finishOnboarding')
  await app.evaluate(() =>
    globalThis.__hoot!.updateSettings({ lens: { enabled: true, consentedAt: 1, mode: 'ask' } })
  )
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

async function readerPage(): Promise<Page> {
  await hook(app, 'openStudio')
  const studio = await studioPage(app)
  await studio.evaluate(() =>
    (
      globalThis as unknown as { hoot: { windows: { openReader(): Promise<void> } } }
    ).hoot.windows.openReader()
  )
  const find = (): Page | undefined => app.windows().find((w) => w.url().includes('reader.html'))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const page = find()!
  await page.waitForLoadState('domcontentloaded')
  return page
}

async function selectInTextLayer(page: Page, needle: string): Promise<void> {
  await page.locator('.hoot-pdf-text span', { hasText: needle }).first().waitFor()
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

test('opens a local PDF and Lens explains a hard word in place', async () => {
  const page = await readerPage()
  await expect(page.getByRole('heading', { name: 'Read a PDF with Hoot Lens' })).toBeVisible()
  await expectAxeClean(page)

  await page.locator('input[type="file"]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'article.pdf' })).toBeVisible()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await expect(page).toHaveTitle('article.pdf – Hoot Reader')

  await selectInTextLayer(page, 'heteroscedasticity')
  const chip = page.locator('hoot-lens-ui .chip')
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page.locator('.hoot-pdf-mark mark')).toHaveText(
    'heteroscedasticity (a fake definition)'
  )
  await expectAxeClean(page)

  // Text only: reflowed article, the overlay marks go away with the pages.
  await page.getByRole('radiogroup', { name: 'View' }).getByText('Text only').click()
  await expect(page.locator('.hoot-pdf-reflow')).toBeVisible()
  await expect(page.locator('.hoot-pdf-mark')).toHaveCount(0)
})

test('says when Lens is off and links to Reading settings', async () => {
  await app.evaluate(() => globalThis.__hoot!.updateSettings({ lens: { enabled: false } }))
  const page = await readerPage()
  await page.locator('input[type="file"]').setInputFiles(FIXTURE)
  await expect(page.getByText('Hoot Lens is off, so nothing here changes.')).toBeVisible()
  await page.getByRole('button', { name: 'Turn it on in Reading settings' }).click()
  await expect.poll(async () => (await hook(app, 'getState')).studio?.view).toBe('reading')
})
