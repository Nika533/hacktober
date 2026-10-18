import {
  chromium,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker
} from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveFixtures, type FixtureServer } from '../scripts/serve.ts'

const EXTENSION = resolve(import.meta.dirname, '../dist')

export interface Harness {
  context: BrowserContext
  worker: Worker
  fixtures: FixtureServer
}

export async function launch(): Promise<Harness> {
  const fixtures = await serveFixtures()
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: { width: 1000, height: 720 },
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  return { context, worker, fixtures }
}

export async function shutdown(harness: Harness): Promise<void> {
  await harness.context.close()
  await harness.fixtures.close()
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

export function matchesAboutBlank(): boolean {
  const manifest = JSON.parse(readFileSync(resolve(EXTENSION, 'manifest.json'), 'utf8')) as {
    content_scripts?: Array<{ match_about_blank?: boolean }>
  }
  return manifest.content_scripts?.[0]?.match_about_blank === true
}

export async function devLog(
  worker: Worker
): Promise<Array<{ kind: string; payload: { kind?: string } }>> {
  return worker.evaluate(async () => {
    const stored = await chrome.storage.session.get('lens.e2eLog')
    return (stored['lens.e2eLog'] ?? []) as Array<{ kind: string; payload: { kind?: string } }>
  })
}

export async function askAbout(page: Page, selector: string): Promise<void> {
  await page.locator(selector).dblclick()
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
}
