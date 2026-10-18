import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import type { HootApi, LensSettingsPatch, StateSlices } from '@hoot/core'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, extensionUrl, launchExtension, open, shutdown, type Harness } from './harness'

/**
 * The page link on the whole stack: this extension → the dev WebSocket bridge
 * → the real Hoot app (fake AI and Lens). A chat in Hoot right after the
 * browser carries the page as text, and the popup's question lands in Hoot's
 * chat with the page. Needs the desktop e2e build, like full-stack.spec.ts.
 */
const MAIN = resolve(import.meta.dirname, '../../desktop/out/main/index.js')
const ELECTRON = createRequire(import.meta.url)('electron') as unknown as string

interface AppHooks {
  getState(): Pick<StateSlices, 'settings' | 'lens' | 'chat'>
  updateSettings(patch: { lens: LensSettingsPatch }): void
  openStudio(): void
}
type AppGlobal = { __hoot?: AppHooks }
type RendererGlobal = { hoot: HootApi }

let app: ElectronApplication
let ext: Pick<Harness, 'context' | 'worker' | 'fixtures'> | null = null
let dir: string

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

const appState = (): Promise<Pick<StateSlices, 'settings' | 'lens' | 'chat'> | null> =>
  app.evaluate(() => (globalThis as AppGlobal).__hoot?.getState() ?? null)

const sentToModel = async (): Promise<string[]> =>
  ((await appState())?.chat.session?.messages ?? [])
    .filter((m) => m.role === 'user')
    .map((m) => m.sentText ?? m.text)

async function studio(): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().endsWith('/studio.html'))
  if (!find()) await app.evaluate(() => (globalThis as AppGlobal).__hoot!.openStudio())
  await expect.poll(() => find() !== undefined).toBe(true)
  const page = find()!
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** The article in front, in a focused browser window, with the bridge up. */
async function articleInFront(): Promise<Page> {
  const { context, worker, fixtures } = ext!
  const page = await context.newPage()
  await open(page, `${fixtures.url}/article.html`)
  await expect.poll(async () => (await appState())?.lens.clients).toBe(1)
  await page.bringToFront()
  await worker.evaluate(async () => {
    const win = await chrome.windows.getLastFocused()
    if (win.id !== undefined) await chrome.windows.update(win.id, { focused: true })
  })
  return page
}

test.beforeEach(async () => {
  test.skip(!existsSync(MAIN), 'needs the desktop e2e build: npm run build:e2e -w @hoot/desktop')
  dir = mkdtempSync(join(tmpdir(), 'hoot-page-link-'))
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
  ext = await launchExtension(`ws://127.0.0.1:${port}/?code=${code}`)
})

test.afterEach(async () => {
  if (ext) await shutdown(ext)
  ext = null
  await app?.close()
  rmSync(dir, { recursive: true, force: true })
})

test('a chat in Hoot right after the browser carries the page as text', async () => {
  await articleInFront()
  const window = await studio()
  await window.evaluate(() =>
    (globalThis as unknown as RendererGlobal).hoot.chat.send({ text: 'What is this page about?' })
  )
  await expect.poll(sentToModel, { timeout: 10_000 }).toHaveLength(1)
  const [sent] = await sentToModel()
  expect(sent).toContain('[Browser: the web page in front of the user, read from')
  expect(sent).toContain('heteroscedasticity')
  expect(sent).toContain('[[find:')
})

test('the popup sends a question about the page to Hoot', async () => {
  const article = await articleInFront()
  const { context, worker } = ext!
  // Its own, unfocused window, so the article stays the tab in front.
  const popupOpened = context.waitForEvent('page')
  await worker.evaluate(
    (url) => chrome.windows.create({ url, focused: false, type: 'popup' }),
    extensionUrl(worker, 'popup.html')
  )
  const popup = await popupOpened
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup.getByText('Ask Hoot about this page')).toBeVisible()
  await expect(popup.locator('.hoot-popup__page')).toHaveText(await article.title())
  await popup.getByRole('textbox', { name: 'Your question' }).fill('Explain the first paragraph')
  await popup.getByRole('button', { name: 'Send to Hoot' }).click()
  await expect.poll(sentToModel, { timeout: 10_000 }).toHaveLength(1)
  const [sent] = await sentToModel()
  expect(sent).toMatch(/^Explain the first paragraph/)
  expect(sent).toContain('heteroscedasticity')
})
