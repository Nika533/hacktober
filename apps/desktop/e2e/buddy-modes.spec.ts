import { expect, test, type ElectronApplication } from '@playwright/test'
import { BUDDY_CANVAS_PAD } from '../src/main/buddy/hitTest'
import {
  dropProfile,
  hook,
  launchHoot,
  newProfile,
  pageFor,
  primaryWorkArea,
  state,
  waitMode,
  windowVisible,
  type HootWindow
} from './helpers/app'

let app: ElectronApplication
let profile: string

test.beforeEach(async () => {
  profile = newProfile()
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

test('first run → onboarding → pill on a padded card canvas with a greeting', async () => {
  app = await launchHoot(profile)
  // First run: Studio opens on onboarding, the owl stays hidden.
  expect((await state(app)).studio.view).toBe('onboarding')

  await hook(app, 'finishOnboarding')
  await waitMode(app, 'pill')

  const buddyPage = await pageFor(app, 'buddy.html')
  const s = await state(app)
  expect(s.buddy.greeting).not.toBeNull()

  const layout = s.buddy.layout
  expect(layout).not.toBeNull()
  // Card canvas + 16 DIP pad on every side (#82).
  expect(layout!.bounds.width).toBe(420 + 2 * BUDDY_CANVAS_PAD)
  expect(layout!.bounds.height).toBe(620 + 2 * BUDDY_CANVAS_PAD)
  const wa = await primaryWorkArea(app)
  const inner = {
    x: layout!.bounds.x + BUDDY_CANVAS_PAD,
    y: layout!.bounds.y + BUDDY_CANVAS_PAD,
    width: layout!.bounds.width - 2 * BUDDY_CANVAS_PAD,
    height: layout!.bounds.height - 2 * BUDDY_CANVAS_PAD
  }
  expect(inner.x).toBeGreaterThanOrEqual(wa.x)
  expect(inner.y).toBeGreaterThanOrEqual(wa.y)
  expect(inner.x + inner.width).toBeLessThanOrEqual(wa.x + wa.width)
  expect(inner.y + inner.height).toBeLessThanOrEqual(wa.y + wa.height)
  // The owl centre sits exactly on the anchor.
  expect(layout!.bounds.x + layout!.owl.x).toBeGreaterThan(0)
  expect(buddyPage.isClosed()).toBe(false)
})

test('collapse to dot, card/hidden requests, Studio interplay', async () => {
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')
  const buddyPage = await pageFor(app, 'buddy.html')

  // Idle + unfocused → dot. The window holds focus from summon, so blur it.
  await hook(app, 'updateSettings', { collapseToDotAfterMs: 1500 })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('buddy.html'))
      ?.blur()
  })
  await expect.poll(async () => (await state(app)).buddy.mode, { timeout: 4_000 }).toBe('dot')

  // Renderer-driven request (window.hoot → IPC), not the test hook.
  await buddyPage.evaluate(() => (window as unknown as HootWindow).hoot.buddy.requestMode('card'))
  await waitMode(app, 'card')
  expect((await state(app)).buddy.answerReady).toBe(false)

  await buddyPage.evaluate(() => (window as unknown as HootWindow).hoot.buddy.requestMode('hidden'))
  await waitMode(app, 'hidden')
  await expect.poll(() => windowVisible(app, 'buddy.html'), { timeout: 2_000 }).toBe(false)

  // Studio opens over the buddy; locking it comes back as the card.
  await hook(app, 'openStudio')
  await expect.poll(() => windowVisible(app, 'studio.html')).toBe(true)
  expect((await state(app)).buddy.mode).toBe('hidden')

  await hook(app, 'lockStudio')
  await waitMode(app, 'card')
})
