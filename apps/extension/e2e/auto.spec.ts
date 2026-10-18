import { test } from '@playwright/test'
import { devLog, expect, extensionUrl, launch, open, shutdown, ui, type Harness } from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

test('Auto mode rewrites a hard term after the dwell and leaves easy text alone', async () => {
  const { context, worker, fixtures } = harness
  const options = await context.newPage()
  await options.goto(extensionUrl(worker, 'options.html'))
  await options.getByRole('radiogroup', { name: 'Mode' }).getByText('Auto').click()
  await expect(options.getByRole('radio', { name: 'Auto' })).toBeChecked()

  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  await page.locator('#p-vif').dblclick({ position: { x: 4, y: 10 } })
  await page.waitForTimeout(2000)
  await expect(ui(page, '.chip')).toBeHidden()
  await expect(page.locator('hoot-lens-mark')).toHaveCount(0)

  await page.locator('#p-ols b').dblclick()
  await expect(page.locator('#p-ols hoot-lens-mark mark')).toHaveText('OLS (Fake Expanded Form)')
  await expect(ui(page, '.chip')).toBeHidden()
  await expect
    .poll(async () => (await devLog(worker)).map((entry) => entry.payload.kind))
    .toEqual(['shown'])
})
