import { expect, test, type ElectronApplication } from '@playwright/test'
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

let app: ElectronApplication
let profile: string

test.beforeEach(() => {
  profile = newProfile()
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

test('summon hints at changed clipboard; arm + send echoes it; unchanged clipboard → no hint', async () => {
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')
  const buddyPage = await pageFor(app, 'buddy.html')

  // Boot-time content is fingerprinted — write AFTER the app is up.
  const clipText = `hoot e2e ${Date.now()}`
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipText)

  await hook(app, 'hide')
  await waitMode(app, 'hidden')
  await hook(app, 'summon')
  await waitMode(app, 'pill')

  await expect
    .poll(async () => {
      const s = await state(app)
      const h = s.chat.clipboardHint
      return [h?.kind, h?.chars, h?.selected ?? false, s.buddy.greeting?.action ?? null]
    })
    .toEqual(['text', clipText.length, false, 'clipboard'])

  await buddyPage.evaluate(() => (window as unknown as HootWindow).hoot.clipboard.arm())
  await expect.poll(async () => (await state(app)).chat.clipboardHint?.selected).toBe(true)

  await buddyPage.evaluate(() =>
    (window as unknown as HootWindow).hoot.chat.send({ text: 'what is this' })
  )
  await expect
    .poll(
      async () => {
        const s = await state(app)
        const msgs = s.chat.session?.messages ?? []
        const user = msgs.filter((m) => m.role === 'user').at(-1)
        const answer = msgs.filter((m) => m.role === 'assistant').at(-1)
        return {
          sentHasClip: user?.sentText?.includes(clipText) ?? false,
          answerDone: answer?.status === 'done',
          answerEchoes: answer?.text?.includes(clipText) ?? false,
          hint: s.chat.clipboardHint
        }
      },
      { timeout: 15_000 }
    )
    .toEqual({ sentHasClip: true, answerDone: true, answerEchoes: true, hint: null })

  // Second summon with an unchanged clipboard → no hint (fingerprint diff).
  await hook(app, 'hide')
  await waitMode(app, 'hidden')
  await hook(app, 'summon')
  await waitMode(app, 'pill')
  await expect.poll(async () => (await state(app)).chat.clipboardHint).toBeNull()
})
