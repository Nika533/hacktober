import { test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, launch, open, shutdown, ui, type Harness } from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

test('content.js stays under 50 KB gzipped', () => {
  const content = readFileSync(resolve(import.meta.dirname, '../dist/content.js'))
  expect(gzipSync(content).length).toBeLessThan(50 * 1024)
})

type Stalls = { stalls: Array<{ at: number; ms: number }> }

/** The main thread's stalls, measured as gaps in a 10 ms heartbeat since `since`. */
const stallsSince = (page: Page, since: number): Promise<number[]> =>
  page.evaluate(
    (from) =>
      (window as unknown as Stalls).stalls
        .filter((stall) => stall.at >= from)
        .map((stall) => Math.round(stall.ms)),
    since
  )

test('selecting text never blocks the page for more than 50 ms', async () => {
  const { context, fixtures } = harness
  const page = await context.newPage()
  await page.addInitScript(() => {
    const scope = window as unknown as Stalls
    scope.stalls = []
    let last = performance.now()
    setInterval(() => {
      const now = performance.now()
      if (now - last > 25) scope.stalls.push({ at: last, ms: now - last - 10 })
      last = now
    }, 10)
  })
  await open(page, `${fixtures.url}/article.html`)
  await page.waitForTimeout(500)
  const before = await page.evaluate(() => performance.now())
  await page.locator('#p-hetero em').dblclick()
  await expect(ui(page, '.chip')).toBeVisible()
  await page.waitForTimeout(1500)
  expect((await stallsSince(page, before)).filter((ms) => ms > 50)).toEqual([])

  const busy = await page.evaluate(() => {
    const start = performance.now()
    while (performance.now() < start + 80);
    return start
  })
  await page.waitForTimeout(100)
  expect(
    Math.max(0, ...(await stallsSince(page, busy - 20))),
    'the heartbeat sees stalls'
  ).toBeGreaterThan(50)
})
