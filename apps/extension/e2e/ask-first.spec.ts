import { test } from '@playwright/test'
import { askAbout, devLog, expect, launch, open, shutdown, ui, type Harness } from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

test('Ask-first rewrites a term in place and restores it exactly', async () => {
  const { context, worker, fixtures } = harness
  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  const before = await page.locator('#article').innerHTML()

  await askAbout(page, '#p-hetero em')
  const mark = page.locator('#p-hetero hoot-lens-mark mark')
  await expect(mark).toHaveText('heteroscedasticity (a fake definition)')
  await expect(ui(page, '.pill .status')).toHaveText('Hoot changed 1 thing')

  await mark.hover()
  const popover = ui(page, '[role="dialog"]')
  await expect(popover).toBeVisible()
  await expect(popover.locator('.original')).toHaveText('heteroscedasticity')
  await popover.locator('[data-action="restore"]').click()

  await expect(page.locator('#p-hetero hoot-lens-mark')).toHaveCount(0)
  await expect.poll(() => page.locator('#article').innerHTML()).toBe(before)
  await expect
    .poll(async () => (await devLog(worker)).map((entry) => entry.payload.kind))
    .toEqual(['shown', 'reverted'])
})

test('copying a changed sentence copies the original', async () => {
  const { context, fixtures } = harness
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixtures.url })
  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  await askAbout(page, '#p-ols b')
  await expect(page.locator('#p-ols hoot-lens-mark mark')).toHaveText('OLS (Fake Expanded Form)')
  await page.locator('#p-ols').click({ clickCount: 3 })
  await page.keyboard.press('Control+C')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('The OLS estimator')
  expect(copied).not.toContain('Fake Expanded Form')
})

test('never offers Lens on code, quotes, inputs or password pages', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await open(page, `${fixtures.url}/code-and-inputs.html`)
  for (const selector of [
    'pre code',
    'blockquote',
    'q',
    '[contenteditable="true"]',
    'a[href="#docs"]'
  ]) {
    await page.locator(selector).first().dblclick()
    await page.waitForTimeout(450)
    await expect(ui(page, '.chip'), selector).toBeHidden()
  }
  await page.locator('#p-plain').dblclick()
  await expect(ui(page, '.chip')).toBeVisible()

  await open(page, `${fixtures.url}/password.html`)
  await page.locator('#p-login').dblclick()
  await page.waitForTimeout(450)
  await expect(ui(page, '.chip')).toBeHidden()
})

test('keyboard map: Alt+Z undoes, Alt+H pauses and the pause survives a reload', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  const before = await page.locator('#article').innerHTML()
  await page.locator('#p-hetero em').dblclick()
  await expect(ui(page, '.chip')).toBeVisible()
  await page.keyboard.press('Alt+L')
  await expect(page.locator('#p-hetero hoot-lens-mark')).toHaveCount(1)
  await page.keyboard.press('Alt+Z')
  await expect.poll(() => page.locator('#article').innerHTML()).toBe(before)

  await page.keyboard.press('Alt+H')
  await expect(ui(page, '.pill .status')).toHaveText('Lens is paused on this site')
  await page.reload()
  await page.locator('hoot-lens-ui').waitFor({ state: 'attached' })
  await page.locator('#p-hetero em').dblclick()
  await page.waitForTimeout(450)
  await expect(ui(page, '.chip')).toBeHidden()
  await page.keyboard.press('Alt+H')
  await page.locator('#p-vif').dblclick()
  await expect(ui(page, '.chip')).toBeVisible()
})

test('uses the overlay on a React page and follows a re-render', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await open(page, `${fixtures.url}/react/index.html`)
  await page.waitForTimeout(3200)
  await page.locator('#p-react').dblclick({ position: { x: 4, y: 10 } })
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
  await expect(ui(page, '.ov-box')).toHaveCount(1)
  await expect(page.locator('#p-react hoot-lens-mark')).toHaveCount(0)
  await page.locator('#rerender').click()
  await page.waitForTimeout(400)
  await expect(ui(page, '.ov-box')).toHaveCount(1)
  await expect(ui(page, '.pill .status')).toHaveText('Hoot changed 1 thing')
  await page.locator('#edit').click()
  await page.waitForTimeout(400)
  await expect(ui(page, '.ov-box')).toHaveCount(0)
})

test('runs inside same-origin frames', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await page.goto(`${fixtures.url}/iframes.html`)
  const frame = page.frameLocator('#same-origin')
  await frame.locator('hoot-lens-ui').waitFor({ state: 'attached' })
  await frame.locator('#p-child').dblclick({ position: { x: 4, y: 10 } })
  await expect(frame.locator('hoot-lens-ui .chip')).toBeVisible()
})
