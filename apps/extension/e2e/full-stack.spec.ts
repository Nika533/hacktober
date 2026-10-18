import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import type { HootApi, LensSettingsPatch, RecentChange, StateSlices } from '@hoot/core'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  askAbout,
  expect,
  extensionUrl,
  launchExtension,
  open,
  shutdown,
  ui,
  type Harness
} from './harness'

/**
 * The whole stack: this extension → the dev WebSocket bridge → the real Hoot
 * app (`HOOT_FAKE_LENS`, so no key or network) → back. CI builds the app in
 * the desktop e2e step just before this suite runs.
 */
const MAIN = resolve(import.meta.dirname, '../../desktop/out/main/index.js')
const ELECTRON = createRequire(import.meta.url)('electron') as unknown as string

/** What the app's e2e build exposes to Playwright (`apps/desktop/src/main/testHooks.ts`). */
interface AppHooks {
  getState(): Pick<StateSlices, 'settings' | 'lens'>
  updateSettings(patch: { lens: LensSettingsPatch }): void
}
type AppGlobal = { __hoot?: AppHooks }
type RendererGlobal = { hoot: HootApi }

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

let app: ElectronApplication
let ext: Pick<Harness, 'context' | 'worker' | 'fixtures'> | null = null
let dir: string

const appState = (): Promise<Pick<StateSlices, 'settings' | 'lens'> | null> =>
  app.evaluate(() => (globalThis as AppGlobal).__hoot?.getState() ?? null)

const patchApp = (patch: LensSettingsPatch): Promise<void> =>
  app.evaluate((_, lens) => (globalThis as AppGlobal).__hoot!.updateSettings({ lens }), patch)

/** Any loaded Hoot window can ask main for Lens data; Studio exists even with --hidden. */
async function studio(): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith('/studio.html'))).toBe(true)
  return app.windows().find((w) => w.url().endsWith('/studio.html'))!
}

test.beforeEach(async () => {
  test.skip(!existsSync(MAIN), 'needs the desktop e2e build: npm run build:e2e -w @hoot/desktop')
  dir = mkdtempSync(join(tmpdir(), 'hoot-full-stack-'))
  const port = await freePort()
  const code = randomBytes(8).toString('hex')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env['ELECTRON_RUN_AS_NODE']
  Object.assign(env, {
    HOOT_TEST: '1',
    HOOT_FAKE_AI: '1',
    HOOT_FAKE_LENS: '1',
    HOOT_DEV_BRIDGE: '1',
    HOOT_DEV_BRIDGE_PORT: String(port),
    HOOT_DEV_BRIDGE_CODE: code,
    HOOT_USER_DATA: join(dir, 'profile')
  })
  app = await electron.launch({ executablePath: ELECTRON, args: [MAIN, '--hidden'], env })

  await expect
    .poll(async () => (await appState())?.lens.bridge ?? 'starting', { timeout: 15_000 })
    .not.toBe('starting')
  const lens = (await appState())!.lens
  test.skip(lens.bridge === 'stopped', `the app's bridge didn't start: ${lens.lastError ?? ''}`)
  await patchApp({ enabled: true, consentedAt: Date.now(), mode: 'ask' })
  ext = await launchExtension(`ws://127.0.0.1:${port}/?code=${code}`)
})

test.afterEach(async () => {
  if (ext) await shutdown(ext)
  ext = null
  await app?.close()
  rmSync(dir, { recursive: true, force: true })
})

test('Ask-first rewrites through the real app, and the app records the change', async () => {
  const { context, worker, fixtures } = ext!
  const options = await context.newPage()
  await options.goto(extensionUrl(worker, 'options.html'))
  await expect(options.getByRole('status')).toHaveText(/^Connected to Hoot \d/)
  await expect
    .poll(async () => (await appState())?.lens)
    .toMatchObject({
      bridge: 'connected',
      clients: 1
    })

  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  await askAbout(page, '#p-hetero em')
  const mark = page.locator('#p-hetero hoot-lens-mark mark')
  await expect(mark).toHaveText(/^heteroscedasticity \(.+\)$/)
  await mark.hover()
  await ui(page, '[role="dialog"] [data-action="restore"]').click()
  await expect(page.locator('#p-hetero hoot-lens-mark')).toHaveCount(0)

  const window = await studio()
  await expect
    .poll(() =>
      window.evaluate(() => (globalThis as unknown as RendererGlobal).hoot.lens.recentChanges(10))
    )
    .toEqual([expect.objectContaining({ original: 'heteroscedasticity' }) as RecentChange])
})

/** Select a paragraph's text (no trailing newline, so it stays one block). */
async function selectParagraph(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((p) => {
    const range = document.createRange()
    range.selectNodeContents(p)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
  })
}

// Demo script step 3 (rebuild-plan §10).
test('“I knew this” restores the term, and the app’s profile now lists it as known', async () => {
  const { context, fixtures } = ext!
  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  await askAbout(page, '#p-hetero em')
  const mark = page.locator('#p-hetero hoot-lens-mark mark')
  await expect(mark).toBeVisible()
  await mark.hover()
  await ui(page, '[role="dialog"] [data-action="knewIt"]').click()
  await expect(page.locator('#p-hetero hoot-lens-mark')).toHaveCount(0)
  await expect(page.locator('#p-hetero em')).toHaveText('heteroscedasticity')

  const window = await studio()
  await expect
    .poll(async () => {
      const view = await window.evaluate(() =>
        (globalThis as unknown as RendererGlobal).hoot.lens.profile()
      )
      return Object.entries(view.profile.terms)
        .filter(([, entry]) => entry.state === 'known')
        .map(([term]) => term.toLowerCase())
    })
    .toContain('heteroscedasticity')
})

// Demo script step 4: a legal page gets a gloss, never a replacement, with the reading-aid note.
test('on a terms-of-service page a dense sentence gets a gloss with the reading-aid note', async () => {
  const { context, fixtures } = ext!
  const page = await context.newPage()
  await open(page, `${fixtures.url}/high-stakes.html`)
  const original = await page.locator('#p-liability').textContent()
  await selectParagraph(page, '#p-liability')
  await expect(ui(page, '.chip')).toBeVisible()
  await ui(page, '.chip').click()
  const mark = page.locator('#p-liability hoot-lens-mark')
  await expect(mark).toHaveCount(1)
  // A gloss keeps the original words on the page.
  expect(await page.locator('#p-liability').textContent()).toBe(original)
  await mark.hover()
  await expect(ui(page, '[role="dialog"]')).toContainText(
    'Reading aid — the original wording is what applies.'
  )
})

test('settings changed on either side show up on the other', async () => {
  const { context, worker } = ext!
  const options = await context.newPage()
  await options.goto(extensionUrl(worker, 'options.html'))
  await expect(options.getByRole('status')).toHaveText(/^Connected to Hoot \d/)

  await options.getByRole('radiogroup', { name: 'Mode' }).getByText('Gloss only').click()
  await expect.poll(async () => (await appState())?.settings.settings.lens.mode).toBe('gloss')

  await patchApp({ mode: 'auto' })
  await expect(options.getByRole('radio', { name: 'Auto' })).toBeChecked()
})
