import { test } from '@playwright/test'
import {
  expect,
  extensionUrl,
  feedbackKinds,
  launch,
  open,
  shutdown,
  ui,
  type Harness
} from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

test('Auto mode rewrites likely-confusing text after the dwell and leaves easy text alone', async () => {
  const { context, worker, fixtures } = harness
  const options = await context.newPage()
  await options.goto(extensionUrl(worker, 'options.html'))
  await expect(options.getByRole('status')).toHaveText('Connected to Hoot 0.0.0-fake')
  await options.getByRole('radiogroup', { name: 'Mode' }).getByText('Auto').click()
  await expect(options.getByRole('radio', { name: 'Auto' })).toBeChecked()
  await expect.poll(async () => (await harness.server.backend.getSettings()).mode).toBe('auto')

  const page = await context.newPage()
  await open(page, `${fixtures.url}/foreign.html`)
  await page.locator('#p-en').dblclick({ position: { x: 4, y: 10 } })
  await page.waitForTimeout(2000)
  await expect(ui(page, '.chip')).toBeHidden()
  await expect(page.locator('hoot-lens-mark')).toHaveCount(0)

  await page.locator('#p-es').dblclick({ position: { x: 4, y: 10 } })
  await expect(page.locator('#p-es hoot-lens-mark')).toHaveCount(1)
  await expect(ui(page, '.chip')).toBeHidden()
  await expect.poll(() => feedbackKinds(harness)).toEqual(['shown'])
  expect(harness.server.backend.events[0]).toMatchObject({
    mode: 'replace',
    transform: 'translate'
  })
})

test('the options page says when Hoot isn’t running', async () => {
  const { context, worker } = harness
  await harness.server.close()
  const options = await context.newPage()
  await options.goto(extensionUrl(worker, 'options.html'))
  await expect(options.getByRole('status')).toHaveText('Hoot isn’t running.')
  await expect(options.getByRole('button', { name: 'Try again' })).toBeVisible()
})
