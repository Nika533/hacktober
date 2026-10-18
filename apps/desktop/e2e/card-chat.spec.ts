import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The Buddy card on the real app: summon → pill → card → a streamed answer,
 * then back down to the pill. Fake AI and Lens, a fresh profile, onboarding
 * finished through the test hook.
 */

let app: ElectronApplication
let userData: string

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'hoot-card-'))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  // Devin/Windsurf hosts export this; Electron would run as plain Node.
  delete env['ELECTRON_RUN_AS_NODE']
  app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: {
      ...env,
      HOOT_TEST: '1',
      HOOT_FAKE_AI: '1',
      HOOT_FAKE_LENS: '1',
      HOOT_USER_DATA: userData
    }
  })
})

test.afterEach(async () => {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
})

async function buddyPage(): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().includes('buddy.html'))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const page = find()!
  await page.waitForLoadState('domcontentloaded')
  return page
}

type Hooks = NonNullable<typeof globalThis.__hoot>
type NoArgHook = { [K in keyof Hooks]: Parameters<Hooks[K]> extends [] ? K : never }[keyof Hooks]

/** Calls a main-process test hook (e2e build + HOOT_TEST only). */
const hook = <K extends NoArgHook>(name: K): Promise<ReturnType<Hooks[K]>> =>
  app.evaluate((_e, n) => (globalThis.__hoot![n] as () => ReturnType<Hooks[K]>)(), name)

const buddyMode = async (): Promise<string> => (await hook('getState')).buddy?.mode ?? ''

async function openCard(): Promise<Page> {
  // Several Electrons start at once on CI; the first launch can take a while.
  await expect
    .poll(() => app.evaluate(() => globalThis.__hoot !== undefined), { timeout: 30_000 })
    .toBe(true)
  await hook('finishOnboarding')
  await hook('summon')
  const page = await buddyPage()
  await expect(page.locator('.hoot-buddy-owl')).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Hoot' })).toBeVisible()
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.locator('.hoot-buddy-card')).toBeVisible()
  return page
}

test('summon shows the pill; Chat opens the card; Esc steps back to the pill', async () => {
  const page = await openCard()
  await expect(page.getByRole('textbox', { name: 'Message Hoot' })).toBeFocused()
  expect(await buddyMode()).toBe('card')

  await page.keyboard.press('Escape')
  await expect(page.locator('.hoot-buddy-card')).toBeHidden()
  await expect(page.getByRole('toolbar', { name: 'Hoot' })).toBeVisible()
  await expect.poll(buddyMode).toBe('pill')

  // The owl collapses the card too, and Esc on the pill hides the buddy.
  await page.getByRole('button', { name: 'Chat with Hoot' }).click()
  await expect(page.locator('.hoot-buddy-card')).toBeVisible()
  await page.getByRole('button', { name: 'Close chat' }).click()
  await expect(page.locator('.hoot-buddy-card')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect.poll(buddyMode).toBe('hidden')
})

test('the card streams an answer with the fake AI', async () => {
  const page = await openCard()
  const box = page.getByRole('textbox', { name: 'Message Hoot' })
  await box.fill('What is a lease?')
  await box.press('Enter')
  const card = page.locator('.hoot-buddy-card')
  await expect(card.locator('.hoot-msg--assistant').last()).not.toBeEmpty()
  await expect(card.getByRole('button', { name: 'Regenerate' })).toBeVisible({ timeout: 15_000 })
})
