import { expect, test, type ElectronApplication } from '@playwright/test'
import {
  dropProfile,
  hook,
  launchHoot,
  newProfile,
  pageFor,
  primaryWorkArea,
  state,
  waitMode,
  type HootWindow
} from './helpers/app'

let app: ElectronApplication
let profile: string

test.beforeEach(() => {
  profile = newProfile()
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

test('setAnchor persists across a restart; resetAnchor returns the default', async () => {
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')

  await hook(app, 'setAnchor', { x: 60, y: 60 })
  await expect
    .poll(async () => {
      const l = (await state(app)).buddy.layout
      return l && [l.openX, l.openY, l.bounds.x + l.owl.x, l.bounds.y + l.owl.y]
    })
    .toEqual(['right', 'down', 60, 60])

  // Quit flushes pending writes; relaunch must land on the same anchor.
  await app.close()
  app = await launchHoot(profile)
  await waitMode(app, 'pill')
  await expect
    .poll(async () => {
      const s = await state(app)
      const l = s.buddy.layout
      return {
        anchor: s.settings.settings.pillAnchor,
        owlAt: l && [l.bounds.x + l.owl.x, l.bounds.y + l.owl.y]
      }
    })
    .toEqual({ anchor: { x: 60, y: 60 }, owlAt: [60, 60] })

  // Settings → reset: pillAnchor clears and the owl returns to the
  // bottom-right default (work area inset 40).
  const buddyPage = await pageFor(app, 'buddy.html')
  await buddyPage.evaluate(() => (window as unknown as HootWindow).hoot.settings.resetAnchor())
  const wa = await primaryWorkArea(app)
  await expect
    .poll(async () => {
      const s = await state(app)
      const l = s.buddy.layout
      return {
        anchor: s.settings.settings.pillAnchor,
        owlAt: l && [l.bounds.x + l.owl.x, l.bounds.y + l.owl.y]
      }
    })
    .toEqual({
      anchor: null,
      owlAt: [wa.x + wa.width - 40, wa.y + wa.height - 40]
    })
})
