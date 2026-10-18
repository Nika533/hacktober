import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  dropProfile,
  hook,
  launchHoot,
  newProfile,
  pageFor,
  state,
  waitMode,
  type HootWindow
} from './helpers/app'

/**
 * F-D1-6: a file dropped on a Hoot surface is a file: navigation the guard
 * reroutes to the Reader; a file in argv ("Open with Hoot") opens it instead
 * of summoning.
 */

const FIXTURE = join(__dirname, '../../../packages/pdf-view/tests/fixtures/article.pdf')
const ELECTRON = join(__dirname, '../../../node_modules/electron/dist/electron.exe')
const MAIN = join(__dirname, '../out/main/index.js')

let app: ElectronApplication
let profile: string

test.beforeEach(() => {
  profile = newProfile()
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

/**
 * A real OS file drop makes Chromium navigate the page to the file: URL and
 * `will-navigate` fires in main. Scripted `location.href` can't fake it —
 * Chromium refuses file: navigations from a hoot:// page — so the spec emits
 * the same event on the window's real webContents and checks it was stopped.
 */
const dropFile = (app: ElectronApplication, page: string, path: string): Promise<boolean> =>
  app.evaluate(
    ({ webContents }, arg) => {
      const wc = webContents.getAllWebContents().find((c) => c.getURL().includes(arg.page))
      if (wc === undefined) return false
      let prevented = false
      wc.emit('will-navigate', {
        url: arg.url,
        preventDefault: () => {
          prevented = true
        }
      })
      return prevented
    },
    { page, url: pathToFileURL(path).href }
  )

/** What the reader currently has open, via any page's preload API. */
const currentDoc = (p: { evaluate: Page['evaluate'] }): Promise<unknown> =>
  p.evaluate(() => (window as unknown as HootWindow).hoot.reader.current())

test('a PDF dropped on the buddy opens in the Reader; buddy stays', async () => {
  const pdf = join(profile, 'drop me.pdf')
  copyFileSync(FIXTURE, pdf)
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')
  const buddyPage = await pageFor(app, 'buddy.html')

  await expect(dropFile(app, 'buddy.html', pdf)).resolves.toBe(true)
  expect(buddyPage.url()).toContain('buddy.html')
  const reader = await pageFor(app, 'reader.html')
  await expect
    .poll(() => currentDoc(reader), { timeout: 10_000 })
    .toMatchObject({
      kind: 'pdf',
      name: 'drop me.pdf'
    })
})

test('an .htm dropped on the Studio page opens in the Reader', async () => {
  const html = join(profile, 'notes.htm')
  writeFileSync(html, '<!doctype html><title>notes</title><p>hi</p>')
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')
  await hook(app, 'openStudio')
  const studio = await pageFor(app, 'studio.html')

  await expect(dropFile(app, 'studio.html', html)).resolves.toBe(true)
  expect(studio.url()).toContain('studio.html')
  const reader = await pageFor(app, 'reader.html')
  await expect
    .poll(() => currentDoc(reader), { timeout: 10_000 })
    .toMatchObject({
      kind: 'html',
      name: 'notes.htm'
    })
})

test('a file in argv opens the Reader instead of summoning the owl', async () => {
  const pdf = join(profile, 'arg.pdf')
  copyFileSync(FIXTURE, pdf)
  app = await launchHoot(profile, { onboardingDone: true }, [pdf])
  const reader = await pageFor(app, 'reader.html')
  await expect
    .poll(() => currentDoc(reader), { timeout: 10_000 })
    .toMatchObject({
      kind: 'pdf',
      name: 'arg.pdf'
    })
  expect((await state(app)).buddy.mode).toBe('hidden')
})

test('a second instance with a file opens it in the running app', async () => {
  const pdf = join(profile, 'second.pdf')
  copyFileSync(FIXTURE, pdf)
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')

  // Not Playwright-launched: the process loses the single-instance lock and
  // exits after handing argv to the first instance.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env['HOOT_USER_DATA'] = profile
  delete env['ELECTRON_RUN_AS_NODE']
  const child = spawn(ELECTRON, [MAIN, pdf], { env, stdio: 'ignore' })
  child.unref()

  const reader = await pageFor(app, 'reader.html')
  await expect
    .poll(() => currentDoc(reader), { timeout: 10_000 })
    .toMatchObject({
      kind: 'pdf',
      name: 'second.pdf'
    })
})
