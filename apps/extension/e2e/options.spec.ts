import AxeBuilder from '@axe-core/playwright'
import { test } from '@playwright/test'
import { expect, extensionUrl, launch, open, shutdown, ui, type Harness } from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

test('site rules from the options page apply to open pages, and Alt+H shows up there', async () => {
  const { context, worker, fixtures } = harness
  const site = new URL(fixtures.url).hostname
  const options = await context.newPage()
  await options.goto(extensionUrl(worker, 'options.html'))
  await expect(options.getByRole('radio', { name: 'Ask first' })).toBeChecked()

  await options.getByLabel('Add a site').fill(`${fixtures.url}/article.html`)
  await options.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(options.locator('.hoot-options__site-name')).toHaveText([site])

  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  await page.locator('#p-hetero em').dblclick()
  await page.waitForTimeout(450)
  await expect(ui(page, '.chip')).toBeHidden()

  await options.getByRole('button', { name: `Remove ${site}` }).click()
  await expect(options.getByText('No site rules yet.')).toBeVisible()
  await page.locator('#p-vif').dblclick()
  await expect(ui(page, '.chip')).toBeVisible()

  await page.keyboard.press('Alt+H')
  await expect(ui(page, '.pill .status')).toHaveText('Lens is paused on this site')
  const rules = options.getByRole('list', { name: 'Site rules' })
  await expect(rules.getByRole('radio', { name: 'Paused' })).toBeChecked()
})

test('the options page passes axe in light and dark', async () => {
  const { context, worker } = harness
  const page = await context.newPage()
  await page.goto(extensionUrl(worker, 'options.html'))
  await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'lens.settings.patch',
      patch: {
        sites: {
          'example.com': 'paused',
          'mail.example.org': 'never',
          'en.wikipedia.org': 'always'
        }
      }
    })
  )
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.reload()
    await expect(page.locator('.hoot-options__site')).toHaveCount(3)
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
    await page.screenshot({ path: test.info().outputPath(`options-${colorScheme}.png`) })
  }
})
