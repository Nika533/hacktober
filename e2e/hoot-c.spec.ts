import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { PNG } from 'pngjs'
import type { BrowserWindow } from 'electron'

import type { AppState } from '../src/shared/types'

const SHOTS = path.join('test-results', 'e2e')
const FIXTURE = path.resolve('e2e', 'fixtures', 'screen.png')

interface HootHooks {
  getState(): AppState
  summon(): void
  hide(): void
  requestMode(m: string): void
  send(t: string): void
  setAnchor(p: { x: number; y: number }): void
  updateSettings(p: Record<string, unknown>): void
  startCapture(mode?: string): Promise<void>
  openStudio(view?: string): void
  lockStudio(): void
  finishOnboarding(): void
  isCapturing(): boolean
  setThemeSource(src: string): void
  assetsOk(): { tray: boolean; app: boolean }
  createPin(messageId: string): void
  listPins(): { id: string; text: string }[]
}

async function launch(
  userData: string,
  extraEnv: Record<string, string> = {}
): Promise<{ app: ElectronApplication; buddy: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: (() => {
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOOT_TEST: '1',
        HOOT_FAKE_AI: '1',
        HOOT_USER_DATA: userData,
        ...extraEnv
      }
      delete env.ELECTRON_RUN_AS_NODE
      return env
    })()
  })
  const buddy = await pageFor(app, 'buddy.html')
  return { app, buddy }
}

async function pageFor(app: ElectronApplication, match: string): Promise<Page> {
  for (let i = 0; i < 80; i++) {
    const p = app.windows().find((w) => w.url().includes(match))
    if (p) return p
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`window ${match} not found`)
}

async function winVisible(app: ElectronApplication, match: string): Promise<boolean> {
  return app.evaluate((e, m) => {
    const w = (e.BrowserWindow.getAllWindows() as BrowserWindow[]).find((win: BrowserWindow) =>
      win.webContents.getURL().includes(m)
    )
    return !!w && !w.isDestroyed() && w.isVisible()
  }, match)
}

async function hooks(app: ElectronApplication): Promise<{
  getState: () => Promise<AppState>
  call: (fn: string, arg?: unknown) => Promise<unknown>
}> {
  return {
    getState: () =>
      app.evaluate(() => (globalThis as unknown as { __hoot: HootHooks }).__hoot.getState()),
    call: (fn: string, arg?: unknown) =>
      app.evaluate(
        (_e, p: { fn: string; arg?: unknown }) => {
          const h = (globalThis as unknown as { __hoot: Record<string, (a?: unknown) => unknown> })
            .__hoot
          return h[p.fn](p.arg)
        },
        { fn, arg }
      )
  }
}

async function waitMode(app: ElectronApplication, mode: string): Promise<void> {
  const h = await hooks(app)
  await expect.poll(async () => (await h.getState()).buddyMode, { timeout: 15000 }).toBe(mode)
}

function opaqueFraction(buf: Buffer): number {
  const png = PNG.sync.read(buf)
  let opaque = 0
  for (let p = 3; p < png.data.length; p += 4) if (png.data[p] > 10) opaque++
  return opaque / (png.width * png.height)
}

async function goodShot(app: ElectronApplication, match = 'buddy.html'): Promise<Buffer> {
  let last = Buffer.alloc(0)
  for (let i = 0; i < 40; i++) {
    const b64 = await app.evaluate(async (e, m) => {
      const w = (e.BrowserWindow.getAllWindows() as BrowserWindow[]).find((win: BrowserWindow) =>
        win.webContents.getURL().includes(m)
      )
      if (!w || !w.isVisible()) return ''
      const img = await w.webContents.capturePage()
      return img.toPNG().toString('base64')
    }, match)
    last = Buffer.from(b64, 'base64')
    if (last.length > 0 && opaqueFraction(last) > 0.02) return last
    await new Promise((r) => setTimeout(r, 150))
  }
  return last
}

/** hide → settle → summon → pill (the full hidden→pill clipboard path). */
async function resummon(app: ElectronApplication): Promise<void> {
  const h = await hooks(app)
  await h.call('hide')
  await waitMode(app, 'hidden')
  await new Promise((r) => setTimeout(r, 600))
  await h.call('summon')
  await waitMode(app, 'pill')
}

// ---------------------------------------------------------------------------

test('hoot milestone C flow', async () => {
  test.setTimeout(300_000)
  mkdirSync(SHOTS, { recursive: true })
  const userData = mkdtempSync(path.join(tmpdir(), 'hoot-e2e-c-'))
  const hootDir = path.join(userData, 'hoot')
  const pinsFile = path.join(hootDir, 'pins.json')

  let { app, buddy: buddyPage } = await launch(userData, {
    HOOT_FAKE_CAPTURE: FIXTURE
  })
  let h = await hooks(app)
  await pageFor(app, 'studio.html')
  await h.call('finishOnboarding')
  await waitMode(app, 'pill')
  await h.call('updateSettings', { collapseToDotAfterMs: 300000 })

  // ---- C1: clipboard text chip ------------------------------------------
  // boot fingerprint covered the pre-existing clipboard → no hint yet
  expect((await h.getState()).clipboardHint).toBeNull()

  await app.evaluate((e) => e.clipboard.writeText('hoot clipboard probe alpha'))
  await resummon(app)
  await expect
    .poll(async () => (await h.getState()).clipboardHint?.kind, { timeout: 10000 })
    .toBe('text')

  // re-summon with unchanged content → no hint
  await resummon(app)
  await new Promise((r) => setTimeout(r, 700))
  expect((await h.getState()).clipboardHint).toBeNull()

  // changed content → hint returns
  await app.evaluate((e) => e.clipboard.writeText('second probe text for hoot'))
  await resummon(app)
  await expect
    .poll(async () => (await h.getState()).clipboardHint?.kind, { timeout: 10000 })
    .toBe('text')

  // the chip shows above the composer and never sends by itself
  await buddyPage.locator('[aria-label="Chat"]').click()
  await waitMode(app, 'card')
  const chip = buddyPage.locator('.clip-chip')
  await expect(chip).toBeVisible({ timeout: 8000 })
  await expect(chip).toContainText('second probe text for hoot'.length + ' chars')
  await chip.click()
  await expect.poll(async () => (await h.getState()).clipboardHint?.selected).toBe(true)
  await new Promise((r) => setTimeout(r, 400))
  expect((await h.getState()).streaming).toBe(false)
  expect((await h.getState()).activeSession?.messages.length ?? 0).toBe(0)

  // select + send → the copied text lands in the request (echoed by the fake)
  const ta = buddyPage.locator('.composer-input')
  await ta.fill('what did I copy?')
  await ta.press('Enter')
  await expect(buddyPage.locator('.msg-bubble.assistant').last()).toContainText(
    'second probe text for hoot',
    { timeout: 15000 }
  )

  // ---- C1b: clipboard image chip → pending attachment --------------------
  const fixtureB64 = readFileSync(FIXTURE).toString('base64')
  await app.evaluate(async (e, b64) => {
    const bytes = Buffer.from(b64, 'base64')
    const item = new e.ClipboardItem({
      'image/png': new Blob([bytes], { type: 'image/png' })
    })
    await e.clipboard.write([item])
  }, fixtureB64)
  await resummon(app)
  await expect
    .poll(async () => (await h.getState()).clipboardHint?.kind, { timeout: 10000 })
    .toBe('image')
  await waitMode(app, 'pill')
  await buddyPage.locator('[aria-label="Chat"]').click()
  await waitMode(app, 'card')
  await buddyPage.locator('.clip-chip').click()
  await expect
    .poll(async () => (await h.getState()).pendingAttachments.length, { timeout: 10000 })
    .toBe(1)
  await expect(buddyPage.locator('.attach-thumb')).toHaveCount(1)
  await ta.fill('and this?')
  await ta.press('Enter')
  await expect(buddyPage.locator('.msg-bubble.assistant').last()).toContainText('1 image(s)', {
    timeout: 15000
  })

  // ---- C2: sticky-note pin ------------------------------------------------
  console.log('C2: pin create')
  // pin only once the answer is final — a streaming answer has no Pin action
  await expect.poll(async () => (await h.getState()).streaming, { timeout: 15000 }).toBe(false)
  const asst = buddyPage.locator('.msg-bubble.assistant').last()
  const asstText = (await asst.textContent()) ?? ''
  const msgRow = buddyPage.locator('.msg-row.assistant').last()
  await msgRow.hover()
  await msgRow.getByRole('button', { name: 'Pin' }).click()
  await expect.poll(async () => (await h.getState()).pins.length).toBe(1)
  await expect.poll(async () => winVisible(app, 'note.html'), { timeout: 10000 }).toBe(true)
  const notePage = await pageFor(app, 'note.html')
  await expect(notePage.locator('.note-card')).toBeVisible({ timeout: 10000 })
  await expect(notePage.locator('.note-body')).toContainText('Fake Hoot answer')
  // the full final answer was pinned, code block included
  await expect(notePage.locator('.note-body')).toContainText("console.log('hoot')")
  // the note window hugs its (short) content instead of sitting at the 420 cap
  const noteHeight = async (): Promise<number> =>
    app.evaluate((e) => {
      const w = e.BrowserWindow.getAllWindows().find((x) =>
        x.webContents.getURL().includes('note.html')
      )
      return w ? w.getBounds().height : -1
    })
  await expect.poll(noteHeight, { timeout: 5000 }).toBeLessThan(400)
  expect(await noteHeight()).toBeGreaterThanOrEqual(120)
  await new Promise((r) => setTimeout(r, 400))
  writeFileSync(path.join(SHOTS, '30-note.png'), await goodShot(app, 'note.html'))

  // Copy writes the pinned text to the clipboard
  console.log('C2: copy')
  await notePage.locator('[aria-label="Copy note"]').click({ timeout: 15000 })
  await expect
    .poll(async () => app.evaluate((e) => e.clipboard.readText()), { timeout: 8000 })
    .toBe((await h.getState()).pins[0].text)

  // Close deletes the pin (state + pins.json + window)
  console.log('C2: close')
  await notePage.locator('[aria-label="Close note"]').click({ timeout: 15000 })
  await expect.poll(async () => (await h.getState()).pins.length).toBe(0)
  await expect.poll(async () => winVisible(app, 'note.html'), { timeout: 8000 }).toBe(false)
  await expect
    .poll(
      () => {
        try {
          return JSON.parse(readFileSync(pinsFile, 'utf8') as string).length as number
        } catch {
          return 0
        }
      },
      { timeout: 8000 }
    )
    .toBe(0)
  // writing the note's copy to the clipboard means the next summon may hint —
  // that's fine, it just must not throw.
  void asstText

  // pin again (via the hook) → survives relaunch when restorePins is on
  console.log('C2: repin + relaunch')
  const lastAsstId = (await h.getState())
    .activeSession!.messages.filter((m) => m.role === 'assistant')
    .at(-1)!.id
  await h.call('createPin', lastAsstId)
  await expect.poll(async () => (await h.getState()).pins.length).toBe(1)
  await expect.poll(async () => winVisible(app, 'note.html'), { timeout: 10000 }).toBe(true)
  await app.close()

  console.log('C2: relaunch w/ restorePins')
  ;({ app, buddy: buddyPage } = await launch(userData))
  h = await hooks(app)
  await buddyPage.waitForTimeout(1000)
  expect((await h.getState()).pins.length).toBe(1)
  await expect.poll(async () => winVisible(app, 'note.html'), { timeout: 15000 }).toBe(true)

  // restorePins off → pin persists in file but no window
  await h.call('updateSettings', { restorePins: false })
  await new Promise((r) => setTimeout(r, 600))
  console.log('C2: relaunch w/o restorePins')
  await app.close()
  ;({ app, buddy: buddyPage } = await launch(userData))
  h = await hooks(app)
  await buddyPage.waitForTimeout(1000)
  expect((await h.getState()).pins.length).toBe(1)
  await expect.poll(async () => winVisible(app, 'note.html'), { timeout: 3000 }).toBe(false)

  // ---- C3: reduced motion ------------------------------------------------
  console.log('C3: reduced motion')
  await h.call('finishOnboarding')
  await waitMode(app, 'pill')
  await h.call('updateSettings', { collapseToDotAfterMs: 300000 })
  await h.call('requestMode', 'card')
  await waitMode(app, 'card')
  await buddyPage.emulateMedia({ reducedMotion: 'reduce' })
  await buddyPage.waitForTimeout(300)
  expect(await buddyPage.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe(
    'true'
  )
  writeFileSync(path.join(SHOTS, '31-card-reduced-motion.png'), await goodShot(app))

  await app.close()
})
