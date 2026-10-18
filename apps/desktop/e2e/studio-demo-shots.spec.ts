/// <reference lib="dom" />
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Demo screenshots for the README and pitch (D3-40), off by default:
 *
 *   HOOT_DEMO_SHOTS=1 npx playwright test studio-demo        (fakes)
 *   HOOT_DEMO_SHOTS=1 HOOT_DEMO_REAL=1 GEMINI_API_KEY=… npx playwright test studio-demo
 *
 * With fakes it skips anything that would show fake model text. Studio is
 * grabbed from the desktop so Mica shows; the buddy is shot with a
 * transparent background so nothing behind it is captured.
 */

const ON = process.env['HOOT_DEMO_SHOTS'] === '1'
const REAL = process.env['HOOT_DEMO_REAL'] === '1'
const OUT = join(__dirname, '../../../packages/ui/screenshots/demo')
const FIXTURE = join(__dirname, '../../../packages/pdf-view/tests/fixtures/article.pdf')

test.skip(!ON, 'demo screenshots run only with HOOT_DEMO_SHOTS=1')
test.setTimeout(180_000)

let app: ElectronApplication
let profile: string

async function launch(): Promise<void> {
  profile = mkdtempSync(join(tmpdir(), 'hoot-demo-'))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env['ELECTRON_RUN_AS_NODE']
  const fakes: Record<string, string> = REAL ? {} : { HOOT_FAKE_AI: '1', HOOT_FAKE_LENS: '1' }
  app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...env, ...fakes, HOOT_TEST: '1', HOOT_USER_DATA: profile }
  })
  await expect.poll(() => app.evaluate(() => globalThis.__hoot !== undefined)).toBe(true)
}

async function windowFor(part: string): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().includes(part))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const page = find()!
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** The window as it looks on screen (Mica included), from a desktop grab. */
async function grab(part: string, name: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }, p) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(p))!
    const d = screen.getDisplayMatching(win.getBounds())
    // Keep the real mouse pointer out of the shot: move the window off it.
    const c = screen.getCursorScreenPoint()
    const w0 = win.getBounds()
    if (c.x >= w0.x && c.x < w0.x + w0.width && c.y >= w0.y && c.y < w0.y + w0.height) {
      const left = c.x - d.workArea.x > d.workArea.width / 2
      win.setPosition(
        left ? d.workArea.x : d.workArea.x + d.workArea.width - w0.width,
        d.workArea.y
      )
    }
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.moveTop()
    await new Promise((r) => setTimeout(r, 700))
    const size = { width: d.size.width * d.scaleFactor, height: d.size.height * d.scaleFactor }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]!
    const ratio = src.thumbnail.getSize().width / d.bounds.width
    const b = win.getBounds()
    win.setAlwaysOnTop(false)
    return src.thumbnail
      .crop({
        x: Math.round((b.x - d.bounds.x) * ratio),
        y: Math.round((b.y - d.bounds.y) * ratio),
        width: Math.round(b.width * ratio),
        height: Math.round(b.height * ratio)
      })
      .toPNG()
      .toString('base64')
  }, part)
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(png, 'base64'))
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, `${name}.png`), omitBackground: true })
}

for (const theme of ['light', 'dark'] as const) {
  test(`demo ${theme}`, async () => {
    mkdirSync(OUT, { recursive: true })
    await launch()
    await app.evaluate(({ nativeTheme }, t) => {
      nativeTheme.themeSource = t
    }, theme)
    await app.evaluate(() => globalThis.__hoot!.finishOnboarding())
    await app.evaluate(() =>
      globalThis.__hoot!.updateSettings({ lens: { enabled: true, consentedAt: 1, mode: 'ask' } })
    )

    // The owl: pill with its greeting, then the card.
    await app.evaluate(() => globalThis.__hoot!.hide())
    await app.evaluate(() => globalThis.__hoot!.summon())
    const buddy = await windowFor('buddy.html')
    await buddy.getByRole('toolbar', { name: 'Hoot' }).waitFor()
    await shot(buddy, `${theme}-buddy-pill`)
    await buddy.getByRole('button', { name: 'Chat', exact: true }).click()
    await buddy.locator('.hoot-buddy-card').waitFor()
    if (REAL) {
      const box = buddy.getByRole('textbox', { name: 'Message Hoot' })
      await box.fill('Explain compound interest in two sentences.')
      await box.press('Enter')
      await buddy.getByRole('button', { name: 'Regenerate' }).waitFor({ timeout: 60_000 })
    }
    await buddy.mouse.move(0, 0)
    await shot(buddy, `${theme}-buddy-card`)

    // Studio: Reading and the profile (with a few words of its own).
    await app.evaluate(() => globalThis.__hoot!.openStudio())
    const studio = await windowFor('studio.html')
    await studio.getByRole('button', { name: 'Reading (Hoot Lens)' }).click()
    await studio.getByRole('heading', { level: 1, name: 'Reading' }).waitFor()
    await grab('studio.html', `${theme}-studio-reading`)
    await studio.getByRole('button', { name: /What Hoot knows about you/ }).click()
    for (const word of ['latency', 'API', 'mortgage']) {
      await studio.getByRole('textbox', { name: 'Add a word you already know' }).fill(word)
      await studio.getByRole('button', { name: 'Add', exact: true }).click()
    }
    await studio.locator('pre').getByText('mortgage', { exact: false }).waitFor()
    await grab('studio.html', `${theme}-studio-profile`)

    // Hoot Reader with a change in place (real Lens only: the fake's text says "fake").
    if (REAL) {
      await studio.evaluate(() =>
        (
          globalThis as unknown as { hoot: { windows: { openReader(): Promise<void> } } }
        ).hoot.windows.openReader()
      )
      const reader = await windowFor('reader.html')
      await reader.locator('input[type="file"]').setInputFiles(FIXTURE)
      await reader.getByText('Page 1 of 2').waitFor()
      await reader
        .locator('.hoot-pdf-text span', { hasText: 'heteroscedasticity' })
        .first()
        .dblclick()
      await reader.locator('hoot-lens-ui .chip').click()
      await reader.locator('.hoot-pdf-mark').first().waitFor({ timeout: 30_000 })
      await grab('reader.html', `${theme}-reader`)
    }

    await app.close()
    rmSync(profile, { recursive: true, force: true })
  })
}
