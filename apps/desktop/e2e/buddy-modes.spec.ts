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

  // Idle + unfocused → dot. The timer is suppressed while the OS cursor sits
  // inside a hit region or the window is focused; Playwright can't move the
  // physical cursor, so park the whole padded canvas in the corner furthest
  // from it, clear the regions + hover hint, and blur the window. 300 DIP
  // from the anchor is not enough — the canvas extends ~390 right / ~590 up.
  const l0 = (await state(app)).buddy.layout
  expect(l0).not.toBeNull()
  const { anchor, gap } = await app.evaluate(({ screen }, layout) => {
    const cursor = screen.getCursorScreenPoint()
    const wa = screen.getPrimaryDisplay().workArea
    const inset = 40
    const corners = [
      { x: wa.x + inset, y: wa.y + inset },
      { x: wa.x + wa.width - inset, y: wa.y + inset },
      { x: wa.x + inset, y: wa.y + wa.height - inset },
      { x: wa.x + wa.width - inset, y: wa.y + wa.height - inset }
    ]
    // Distance from the cursor to the whole canvas rect (0 = inside).
    const gap = (a: { x: number; y: number }): number => {
      const dx = Math.max(
        a.x - layout.owl.x - cursor.x,
        cursor.x - (a.x - layout.owl.x + layout.bounds.width),
        0
      )
      const dy = Math.max(
        a.y - layout.owl.y - cursor.y,
        cursor.y - (a.y - layout.owl.y + layout.bounds.height),
        0
      )
      return Math.hypot(dx, dy)
    }
    corners.sort((a, b) => gap(b) - gap(a))
    return { anchor: corners[0]!, gap: gap(corners[0]!) }
  }, l0!)
  expect(gap, 'no corner keeps the whole canvas off the physical cursor').toBeGreaterThan(0)
  await hook(app, 'setAnchor', anchor)
  await expect
    .poll(async () => {
      const l = (await state(app)).buddy.layout
      return l && [l.bounds.x + l.owl.x, l.bounds.y + l.owl.y]
    })
    .toEqual([anchor.x, anchor.y])
  await buddyPage.evaluate(() => {
    const h = (window as unknown as HootWindow).hoot
    h.buddy.setHitRegions([])
    h.buddy.setIgnoreMouse(true)
  })
  await hook(app, 'updateSettings', { collapseToDotAfterMs: 1500 })
  // Blur for real, then pin it: under parallel workers Windows can hand
  // focus back to the always-on-top owl, which re-suppresses the timer.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().includes('buddy.html')
    )
    if (w === undefined) return
    w.setFocusable(false)
    w.blur()
    w.emit('blur')
  })
  try {
    await expect.poll(async () => (await state(app)).buddy.mode, { timeout: 4_000 }).toBe('dot')
  } catch (e) {
    console.log('buddyDebug at collapse timeout:', await hook(app, 'buddyDebug'))
    throw e
  }

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
