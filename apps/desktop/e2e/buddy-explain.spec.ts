import { expect, test, type ElectronApplication } from '@playwright/test'
import type { LensContext } from '@hoot/core'
import {
  dropProfile,
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

const PARAGRAPH = 'The residuals show heteroscedasticity, so the standard errors are unreliable.'

/** Same shape as @hoot/core test fixtures' sampleContext(). */
const ctx: LensContext = {
  span: 'heteroscedasticity',
  paragraph: PARAGRAPH,
  headingPath: ['Regression diagnostics'],
  title: 'A gentle guide to regression',
  lang: 'en',
  site: 'example.com',
  siteCategory: 'general',
  surface: 'html',
  signals: {
    sizeClass: 'term',
    copiedWithinMs: null,
    dwellMs: 1500,
    reselectCount: 0,
    reread: 0,
    rarity: 0.8,
    knownTerm: false,
    topicFamiliarity: null,
    foreignLanguage: false,
    blocked: null
  },
  p: 0.8
}

test('lens.explain opens the card and streams the explanation', async () => {
  app = await launchHoot(profile, { onboardingDone: true })
  await waitMode(app, 'pill')
  const buddyPage = await pageFor(app, 'buddy.html')

  // "Explain more" does not gate on lens.enabled — the hook surfaces chat.
  await buddyPage.evaluate((c) => (window as unknown as HootWindow).hoot.lens.explain(c), ctx)
  await waitMode(app, 'card')

  await expect
    .poll(
      async () => {
        const msgs = (await state(app)).chat.session?.messages ?? []
        const user = msgs.filter((m) => m.role === 'user').at(-1)
        const answer = msgs.filter((m) => m.role === 'assistant').at(-1)
        return {
          text: user?.text,
          sentHasParagraph: user?.sentText?.includes(PARAGRAPH) ?? false,
          answerStatus: answer?.status ?? null
        }
      },
      { timeout: 15_000 }
    )
    .toEqual({
      text: 'Explain “heteroscedasticity”',
      sentHasParagraph: true,
      answerStatus: 'done'
    })
})
