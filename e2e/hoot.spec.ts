import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
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
}

const FIXTURE_ENV = { HOOT_FAKE_CAPTURE: FIXTURE }

async function launch(
  userData: string,
  extraEnv: Record<string, string> = {}
): Promise<{
  app: ElectronApplication
  buddy: Page
}> {
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
      // The Windsurf/Devin host exports ELECTRON_RUN_AS_NODE=1, which would
      // make electron.exe run in Node mode — strip it for the child app.
      delete env.ELECTRON_RUN_AS_NODE
      return env
    })()
  })
  const buddy = await pageFor(app, 'buddy.html')
  return { app, buddy }
}

/** Find (or wait for) the page of a window whose URL contains `match`. */
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

interface Hooks {
  getState(): Promise<AppState>
  call(fn: string, arg?: unknown): Promise<unknown>
}

async function hoot(app: ElectronApplication): Promise<Hooks> {
  return {
    getState: () =>
      app.evaluate(() => (globalThis as unknown as { __hoot: HootHooks }).__hoot.getState()),
    call: (fn, arg) =>
      app.evaluate(
        (_electron, p: { fn: string; arg?: unknown }) => {
          const h = (globalThis as unknown as { __hoot: Record<string, (a?: unknown) => unknown> })
            .__hoot
          return h[p.fn](p.arg)
        },
        { fn, arg }
      )
  }
}

/** Switch nativeTheme.themeSource and wait for the renderer's data-theme to follow. */
async function setTheme(
  app: ElectronApplication,
  page: Page,
  src: 'light' | 'dark' | 'system'
): Promise<void> {
  await (await hoot(app)).call('setThemeSource', src)
  const want =
    src === 'system'
      ? await app.evaluate((e) => (e.nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
      : src
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 })
    .toBe(want)
  await page.waitForTimeout(150)
}

async function waitMode(app: ElectronApplication, mode: string): Promise<void> {
  await expect
    .poll(async () => (await (await hoot(app)).getState()).buddyMode, { timeout: 15000 })
    .toBe(mode)
}

function opaqueFraction(buf: Buffer): number {
  const png = PNG.sync.read(buf)
  let opaque = 0
  for (let p = 3; p < png.data.length; p += 4) if (png.data[p] > 10) opaque++
  return opaque / (png.width * png.height)
}

/** capturePage of the window whose URL contains `match`; retries blank frames. */
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
  console.log('GOODSHOT-FAIL', match)
  return last
}

async function paintedShot(
  app: ElectronApplication,
  file: string,
  match = 'buddy.html'
): Promise<void> {
  await goodShot(app, match)
  await new Promise((r) => setTimeout(r, 400))
  writeFileSync(file, await goodShot(app, match))
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

/**
 * Wait until the overlay window is actually shown and its `overlay:open`
 * push has had time to land — the renderer clears any in-flight gesture
 * on open, so dragging too early silently cancels the capture.
 */
async function waitOverlayUp(app: ElectronApplication, overlayPage: Page): Promise<void> {
  await expect.poll(() => winVisible(app, 'overlay.html'), { timeout: 10000 }).toBe(true)
  await expect(overlayPage.locator('.overlay-shot')).toBeAttached({ timeout: 10000 })
  await overlayPage.waitForTimeout(200)
}

// ---------------------------------------------------------------------------

test('hoot milestone A flow', async () => {
  test.setTimeout(120_000)
  mkdirSync(SHOTS, { recursive: true })
  const userData = mkdtempSync(path.join(tmpdir(), 'hoot-e2e-a-'))

  // 1. first run → Studio onboarding; finish it via the hook → pill
  let { app, buddy: buddyPage } = await launch(userData)
  await pageFor(app, 'studio.html')
  let hooks = await hoot(app)
  await expect
    .poll(async () => (await hooks.getState()).studioView, { timeout: 10000 })
    .toBe('onboarding')
  await hooks.call('finishOnboarding')
  await waitMode(app, 'pill')
  // keep the pill from collapsing to the dot while the runner holds focus
  await hooks.call('updateSettings', { collapseToDotAfterMs: 300000 })

  // 2. hide → hidden (let the window actually hide)
  await hooks.call('hide')
  await waitMode(app, 'hidden')
  await buddyPage.waitForTimeout(600)

  // 3. summon → pill + greeting + screenshot
  await hooks.call('summon')
  await waitMode(app, 'pill')
  await expect(buddyPage.locator('.greeting')).toBeVisible({ timeout: 8000 })
  const greeting = (await hooks.getState()).greeting
  expect(greeting).not.toBeNull()
  await expect(buddyPage.locator('.greeting')).toContainText(greeting!.title)
  await paintedShot(app, path.join(SHOTS, '03-pill.png'))

  // 4. chat button → card
  await buddyPage.locator('[aria-label="Chat"]').click()
  await waitMode(app, 'card')
  await paintedShot(app, path.join(SHOTS, '04-card.png'))

  // 5. type + Enter → fake answer streams, rendered exactly once
  const ta = buddyPage.locator('.composer-input')
  await ta.fill('Hello Hoot')
  await ta.press('Enter')
  await expect(buddyPage.locator('.msg-bubble.assistant')).toContainText('Fake Hoot answer', {
    timeout: 15000
  })
  await expect(buddyPage.locator('.msg-bubble.assistant')).toContainText('hoot', {
    timeout: 10000
  })
  const answerCount = async (): Promise<number> =>
    buddyPage.evaluate(() => {
      const t = document.querySelector('.msg-bubble.assistant')?.textContent ?? ''
      return t.split('Fake Hoot answer').length - 1
    })
  expect(await answerCount()).toBe(1)
  // a later state broadcast must not re-append streamed deltas
  await buddyPage.evaluate(() =>
    (
      window as unknown as { hoot: { buddy: { dismissGreeting(): void } } }
    ).hoot.buddy.dismissGreeting()
  )
  await buddyPage.waitForTimeout(300)
  expect(await answerCount()).toBe(1)
  await buddyPage.waitForTimeout(200)
  await paintedShot(app, path.join(SHOTS, '05-answer.png'))

  // 6. Esc → pill, Esc → hidden
  await buddyPage.keyboard.press('Escape')
  await waitMode(app, 'pill')
  await buddyPage.keyboard.press('Escape')
  await waitMode(app, 'hidden')

  await app.close()

  // 7. relaunch, same userData → session restored
  ;({ app, buddy: buddyPage } = await launch(userData))
  hooks = await hoot(app)
  await buddyPage.waitForTimeout(800)
  let s = await hooks.getState()
  expect(s.sessions).toHaveLength(1)
  await hooks.call('requestMode', 'card')
  await waitMode(app, 'card')
  await expect(buddyPage.locator('.msg-bubble.user')).toContainText('Hello Hoot', {
    timeout: 10000
  })
  await expect(buddyPage.locator('.msg-bubble.assistant')).toContainText('Fake Hoot answer')

  // 8. anchor top-left → card opens right/down inside work area
  await hooks.call('requestMode', 'pill')
  await waitMode(app, 'pill')
  await buddyPage.waitForTimeout(600)
  await hooks.call('setAnchor', { x: 60, y: 60 })
  await hooks.call('requestMode', 'card')
  await waitMode(app, 'card')
  await buddyPage.waitForTimeout(400)
  s = await hooks.getState()
  const wa = await app.evaluate((e) => e.screen.getPrimaryDisplay().workArea)
  const layout = s.buddyLayout!
  const b = layout.bounds
  expect(b.x).toBeGreaterThanOrEqual(wa.x)
  expect(b.y).toBeGreaterThanOrEqual(wa.y)
  expect(b.x + b.width).toBeLessThanOrEqual(wa.x + wa.width)
  expect(b.y + b.height).toBeLessThanOrEqual(wa.y + wa.height)
  expect(layout.openX).toBe('right')
  expect(layout.openY).toBe('down')
  await paintedShot(app, path.join(SHOTS, '08-card-topleft.png'))

  // 9. dark mode screenshot — drive the real theme path (nativeTheme →
  // AppState.darkMode → data-theme); emulateMedia loses to data-theme.
  await setTheme(app, buddyPage, 'dark')
  expect(
    await buddyPage.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
    )
  ).toBe('#f5f5f7')
  await paintedShot(app, path.join(SHOTS, '09-card-dark.png'))
  await setTheme(app, buddyPage, 'light')

  await app.close()
})

// ---------------------------------------------------------------------------

test('hoot milestone B flow', async () => {
  test.setTimeout(300_000)
  mkdirSync(SHOTS, { recursive: true })
  const userData = mkdtempSync(path.join(tmpdir(), 'hoot-e2e-b-'))
  const hootDir = path.join(userData, 'hoot')

  const { app, buddy: buddyPage } = await launch(userData, FIXTURE_ENV)
  const hooks = await hoot(app)
  const studioPage = await pageFor(app, 'studio.html')
  const overlayPage = await pageFor(app, 'overlay.html')

  // ---- 1. onboarding ---------------------------------------------------
  await expect(studioPage.locator('.ob-step')).toBeVisible({ timeout: 15000 })
  await paintedShot(app, path.join(SHOTS, '20-onboarding-1.png'), 'studio.html')
  await studioPage.getByRole('button', { name: 'Continue' }).click()
  await expect(studioPage.locator('.ob-key')).toBeVisible()
  await paintedShot(app, path.join(SHOTS, '21-onboarding-2.png'), 'studio.html')
  await studioPage.getByRole('button', { name: 'Skip for now' }).click()
  await expect(studioPage.getByText('Summon me anytime')).toBeVisible()
  await paintedShot(app, path.join(SHOTS, '22-onboarding-3.png'), 'studio.html')
  await studioPage.getByRole('button', { name: 'Finish' }).click()
  await expect.poll(async () => winVisible(app, 'studio.html'), { timeout: 10000 }).toBe(false)
  await waitMode(app, 'pill')
  await expect(buddyPage.locator('.greeting')).toBeVisible({ timeout: 8000 })
  await hooks.call('updateSettings', { collapseToDotAfterMs: 300000 })

  // ---- 2. rectangle capture -------------------------------------------
  await buddyPage.locator('[aria-label="Chat"]').click()
  await waitMode(app, 'card')
  await hooks.call('startCapture', 'rect')
  await waitOverlayUp(app, overlayPage)
  // keep every coordinate inside the (possibly small) overlay viewport
  const view = await overlayPage.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  const vx = (f: number): number => Math.round(view.w * f)
  const vy = (f: number): number => Math.round(view.h * f)
  await overlayPage.mouse.move(vx(0.26), vy(0.32))
  await overlayPage.mouse.down()
  await overlayPage.mouse.move(vx(0.37), vy(0.42), { steps: 4 })
  await overlayPage.mouse.move(vx(0.65), vy(0.75), { steps: 4 })
  // mid-drag: veil + un-dimmed rect + accent stroke
  writeFileSync(path.join(SHOTS, '23-overlay-mid-drag.png'), await goodShot(app, 'overlay.html'))
  await overlayPage.mouse.up()
  await waitMode(app, 'card')
  await expect
    .poll(async () => (await hooks.getState()).pendingAttachments.length, { timeout: 10000 })
    .toBe(1)
  await expect(buddyPage.locator('.attach-thumb')).toHaveCount(1)
  await expect(buddyPage.locator('.chip-row .chip')).toHaveCount(5)
  await paintedShot(app, path.join(SHOTS, '24-card-attachment.png'))

  // ---- 3. Explain chip ---------------------------------------------------
  await buddyPage.getByRole('button', { name: 'Explain' }).click()
  await expect(buddyPage.locator('.msg-bubble.assistant').last()).toContainText('1 image(s)', {
    timeout: 15000
  })
  await expect(buddyPage.locator('.msg-attach img')).toHaveCount(1)
  await expect(buddyPage.locator('.msg-bubble.user').last()).toContainText('Explain')
  await paintedShot(app, path.join(SHOTS, '25-explain.png'))

  // ---- 4. lasso + second capture → 2 pending → send text ----------------
  await hooks.call('startCapture', 'lasso')
  await waitOverlayUp(app, overlayPage)
  await overlayPage.mouse.move(vx(0.55), vy(0.35))
  await overlayPage.mouse.down()
  await overlayPage.mouse.move(vx(0.75), vy(0.3), { steps: 3 })
  await overlayPage.mouse.move(vx(0.88), vy(0.55), { steps: 3 })
  await overlayPage.mouse.move(vx(0.8), vy(0.85), { steps: 3 })
  await overlayPage.mouse.move(vx(0.58), vy(0.8), { steps: 3 })
  await overlayPage.mouse.up()
  await expect
    .poll(async () => (await hooks.getState()).pendingAttachments.length, { timeout: 10000 })
    .toBe(1)

  await hooks.call('startCapture', 'rect')
  await waitOverlayUp(app, overlayPage)
  await overlayPage.mouse.move(vx(0.15), vy(0.6))
  await overlayPage.mouse.down()
  await overlayPage.mouse.move(vx(0.45), vy(0.9), { steps: 4 })
  await overlayPage.mouse.up()
  await expect
    .poll(async () => (await hooks.getState()).pendingAttachments.length, { timeout: 10000 })
    .toBe(2)

  const cta = buddyPage.locator('.composer-input')
  await cta.fill('what are these two')
  await cta.press('Enter')
  await expect(buddyPage.locator('.msg-bubble.assistant').last()).toContainText('2 image(s)', {
    timeout: 15000
  })

  // ---- 5. Esc cancels: buddy restored, no new attachment -----------------
  await hooks.call('startCapture')
  await waitOverlayUp(app, overlayPage)
  await overlayPage.keyboard.press('Escape')
  await expect.poll(async () => winVisible(app, 'overlay.html'), { timeout: 10000 }).toBe(false)
  await waitMode(app, 'card')
  expect((await hooks.getState()).pendingAttachments).toHaveLength(0)

  // ---- 6. unlock → Studio; Ctrl+L → card; studio.close() → lock ----------
  await buddyPage.locator('[aria-label="Unlock into Studio"]').click()
  await expect.poll(async () => winVisible(app, 'studio.html'), { timeout: 10000 }).toBe(true)
  await expect.poll(async () => winVisible(app, 'buddy.html'), { timeout: 10000 }).toBe(false)
  const activeTitle = (await hooks.getState()).activeSession!.title
  await expect(studioPage.locator('.pane-title')).toHaveValue(activeTitle, { timeout: 10000 })
  await expect(studioPage.locator('.msg-bubble.assistant').last()).toContainText('2 image(s)')
  await paintedShot(app, path.join(SHOTS, '26-studio.png'), 'studio.html')

  await studioPage.keyboard.press('Control+l')
  await waitMode(app, 'card')
  await expect.poll(async () => winVisible(app, 'studio.html'), { timeout: 10000 }).toBe(false)

  // native close locks instead of quitting
  await hooks.call('openStudio', 'chat')
  await expect.poll(async () => winVisible(app, 'studio.html'), { timeout: 10000 }).toBe(true)
  await app.evaluate((e) => {
    const w = (e.BrowserWindow.getAllWindows() as BrowserWindow[]).find((win: BrowserWindow) =>
      win.webContents.getURL().includes('studio.html')
    )
    w?.close()
  })
  await waitMode(app, 'card')
  await expect.poll(async () => (await hooks.getState()).studioOpen, { timeout: 10000 }).toBe(false)
  // app stays alive — state still answerable
  expect((await hooks.getState()).buddyMode).toBe('card')

  // ---- 7. settings -------------------------------------------------------
  await hooks.call('openStudio', 'settings')
  await expect(studioPage.locator('.settings-scroll')).toBeVisible({ timeout: 10000 })

  const settingsFile = path.join(hootDir, 'settings.json')
  await studioPage.getByRole('button', { name: /Argon/ }).click()
  await expect
    .poll(() => {
      try {
        return readJson<{ model: string }>(settingsFile).model
      } catch {
        return ''
      }
    })
    .toBe('gemini-4-argon')

  await studioPage.locator('input[type="password"]').fill('AIza-test')
  await studioPage.getByRole('button', { name: 'Save' }).click()
  await expect(studioPage.getByText('Connected')).toBeVisible({ timeout: 10000 })
  await expect.poll(async () => (await hooks.getState()).hasApiKey).toBe(true)

  // hotkey recorder: click the summon field, press Ctrl+Shift+K
  await studioPage.locator('.keycap-field').first().click()
  await expect(studioPage.locator('.keycap-field').first()).toContainText('Press keys')
  await studioPage.keyboard.press('Control+Shift+k')
  await expect
    .poll(() => {
      try {
        return readJson<{ summonHotkey: string }>(settingsFile).summonHotkey
      } catch {
        return ''
      }
    })
    .toBe('CommandOrControl+Shift+K')

  // ---- 8. sidebar: new chat, rename, delete + undo, real delete ----------
  await hooks.call('openStudio', 'chat')
  await expect(studioPage.locator('.chat-body')).toBeVisible({ timeout: 10000 })
  await studioPage.getByRole('button', { name: 'New chat' }).click()
  const sta = studioPage.locator('.composer-input')
  await sta.fill('second chat hello')
  await sta.press('Enter')
  await expect(studioPage.locator('.msg-bubble.assistant').last()).toContainText(
    'Fake Hoot answer',
    { timeout: 15000 }
  )
  const todayRows = studioPage.locator('.sess-group', { hasText: 'Today' }).locator('.sess-row')
  await expect(todayRows).toHaveCount(2, { timeout: 10000 })

  // rename the first row (most recent = the new chat)
  const row0 = todayRows.first()
  const renamedId = (await hooks.getState()).sessions[0].id
  await row0.dblclick()
  const renameInput = studioPage.locator('.sess-rename')
  await renameInput.fill('Renamed chat')
  await renameInput.press('Enter')
  await expect(todayRows.first()).toContainText('Renamed chat')
  await expect
    .poll(() => {
      try {
        return readJson<{ sessions: { id: string; title: string }[] }>(
          path.join(hootDir, 'sessions', 'index.json')
        ).sessions.find((s) => s.id === renamedId)?.title
      } catch {
        return ''
      }
    })
    .toBe('Renamed chat')

  // delete → Undo restores
  const targetId = (await hooks.getState()).sessions[1].id
  const row1 = todayRows.nth(1)
  await row1.hover()
  await row1.locator('.sess-trash').click()
  await expect(studioPage.locator('.toast')).toBeVisible()
  await studioPage.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(todayRows).toHaveCount(2)

  // delete for real → file gone after the 5 s undo window
  const row1b = todayRows.nth(1)
  await row1b.hover()
  await row1b.locator('.sess-trash').click()
  await expect(todayRows).toHaveCount(1)
  const sessionFile = path.join(hootDir, 'sessions', `${targetId}.json`)
  await expect.poll(() => existsSync(sessionFile), { timeout: 9000 }).toBe(false)

  // ---- 9. dark-mode Studio ----------------------------------------------
  // Keep Studio un-occluded: Chromium stops painting a covered window and
  // capturePage then returns an empty image.
  await app.evaluate((e) => {
    const w = e.BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().includes('studio.html')
    )
    w?.setAlwaysOnTop(true, 'pop-up-menu')
    w?.moveTop()
  })
  await setTheme(app, studioPage, 'dark')
  await studioPage.waitForTimeout(400)
  await paintedShot(app, path.join(SHOTS, '27-studio-dark.png'), 'studio.html')
  expect(readFileSync(path.join(SHOTS, '27-studio-dark.png')).length).toBeGreaterThan(0)
  await setTheme(app, studioPage, 'system')

  await app.close()
})
