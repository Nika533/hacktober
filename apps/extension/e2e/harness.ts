import { createFakeLensServer, type FakeLensServer } from '@hoot/bridge/testing'
import { DEFAULT_LENS_SETTINGS } from '@hoot/core'
import {
  chromium,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker
} from '@playwright/test'
import { resolve } from 'node:path'
import { serveFixtures, type FixtureServer } from '../scripts/serve.ts'

const EXTENSION = resolve(import.meta.dirname, '../dist')

export interface Harness {
  context: BrowserContext
  worker: Worker
  fixtures: FixtureServer
  /** C-13's fake protocol server, which the e2e build's service worker talks to */
  server: FakeLensServer
}

export async function launch(): Promise<Harness> {
  const fixtures = await serveFixtures()
  const server = await createFakeLensServer({
    delayMs: 250,
    settings: { ...DEFAULT_LENS_SETTINGS, enabled: true, consentedAt: 0, mode: 'ask' }
  })
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: { width: 1000, height: 720 },
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  await worker.evaluate((url) => chrome.storage.local.set({ 'lens.devBridge': url }), server.url)
  return { context, worker, fixtures, server }
}

export async function shutdown(harness: Harness): Promise<void> {
  await harness.context.close()
  await harness.fixtures.close()
  await harness.server.close()
}

export { expect }

export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('hoot-lens-ui').waitFor({ state: 'attached' })
}

export const ui = (page: Page, selector: string): Locator =>
  page.locator(`hoot-lens-ui ${selector}`)

export const extensionUrl = (worker: Worker, path: string): string =>
  `chrome-extension://${new URL(worker.url()).host}/${path}`

/** Feedback kinds the app received, in order. */
export const feedbackKinds = (harness: Harness): string[] =>
  harness.server.backend.events.map((event) => event.kind)

export async function askAbout(page: Page, selector: string): Promise<void> {
  await page.locator(selector).dblclick()
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
}
