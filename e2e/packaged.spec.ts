import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { BrowserWindow } from 'electron'

// Packaged smoke test — runs against dist/win-unpacked after `build:win`.
const EXE = path.resolve('dist', 'win-unpacked', 'hoot.exe')

test.skip(!existsSync(EXE), 'dist/win-unpacked/hoot.exe missing — run npm.cmd run build:win first')

test('packaged build boots + streams (win-unpacked)', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(path.join(tmpdir(), 'hoot-pkg-'))
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOOT_TEST: '1',
    HOOT_FAKE_AI: '1',
    HOOT_USER_DATA: userData
  }
  delete env.ELECTRON_RUN_AS_NODE

  const consoleErrors: string[] = []
  const app = await electron.launch({ executablePath: EXE, args: [], env })
  app.on('window', (p: Page) => {
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${p.url()}: ${m.text()}`)
    })
    p.on('pageerror', (e) => consoleErrors.push(`${p.url()}: ${e.message}`))
  })

  const pageFor = async (match: string): Promise<Page> => {
    for (let i = 0; i < 80; i++) {
      const p = app.windows().find((w) => w.url().includes(match))
      if (p) return p
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`window ${match} not found`)
  }

  const buddy = await pageFor('buddy.html')
  await pageFor('studio.html')
  await pageFor('overlay.html')

  // Resource paths resolve inside asar: tray + app icons are non-empty.
  const assets = await app.evaluate(() =>
    (
      globalThis as unknown as { __hoot: { assetsOk(): { tray: boolean; app: boolean } } }
    ).__hoot.assetsOk()
  )
  expect(assets.tray).toBe(true)
  expect(assets.app).toBe(true)

  const call = (fn: string, arg?: unknown): Promise<unknown> =>
    app.evaluate(
      (_e, p: { fn: string; arg?: unknown }) =>
        (globalThis as unknown as { __hoot: Record<string, (a?: unknown) => unknown> }).__hoot[
          p.fn
        ](p.arg),
      { fn, arg }
    )
  const mode = async (): Promise<string> =>
    (
      (await app.evaluate(() =>
        (
          globalThis as unknown as { __hoot: { getState(): { buddyMode: string } } }
        ).__hoot.getState()
      )) as { buddyMode: string }
    ).buddyMode

  await call('finishOnboarding')
  await expect.poll(mode, { timeout: 15000 }).toBe('pill')

  const studioWin = await app.evaluate((e) =>
    (e.BrowserWindow.getAllWindows() as BrowserWindow[]).some((w) =>
      w.webContents.getURL().includes('studio.html')
    )
  )
  expect(studioWin).toBe(true)

  await buddy.locator('[aria-label="Chat"]').click()
  await expect.poll(mode, { timeout: 15000 }).toBe('card')
  await buddy.locator('.composer-input').fill('packaged smoke')
  await buddy.locator('.composer-input').press('Enter')
  await expect(buddy.locator('.msg-bubble.assistant').last()).toContainText('Fake Hoot answer', {
    timeout: 20000
  })

  expect(consoleErrors).toEqual([])
  await app.close()
})
