import { expect, test, type ElectronApplication, type Locator } from '@playwright/test'
import { dropProfile, expectAxeClean, hook, launch, newProfile, studioPage } from './studio-app'

let app: ElectronApplication
let profile: string

test.beforeEach(async () => {
  profile = newProfile()
  app = await launch(profile)
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

test('first run walks through onboarding, then hands over to the owl', async () => {
  const page = await studioPage(app)
  const step = (title: string): Locator => page.getByRole('heading', { level: 1, name: title })

  await expect(step('Hi, I’m Hoot')).toBeVisible()
  await expectAxeClean(page)
  await page.getByRole('button', { name: 'Get started' }).click()

  await expect(step('Connect Gemini')).toBeVisible()
  await expectAxeClean(page)
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(step('Your shortcuts')).toBeVisible()
  await expectAxeClean(page)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(step('You’re all set')).toBeVisible()
  await expectAxeClean(page)
  await page.getByRole('button', { name: 'Start using Hoot' }).click()

  await expect
    .poll(async () => {
      const s = await hook(app, 'getState')
      return [s.settings?.settings.onboardingDone, s.studio?.view, s.buddy?.mode]
    })
    .toEqual([true, 'chat', 'pill'])
})

test('onboarding resumes on the step it was left on', async () => {
  test.fixme(true, 'studio.onboardingStep is not persisted yet (#70)')
  const page = await studioPage(app)
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Connect Gemini' })).toBeVisible()
  await app.close()

  app = await launch(profile)
  const again = await studioPage(app)
  await expect(again.getByRole('heading', { level: 1, name: 'Connect Gemini' })).toBeVisible()
})
