import { expect, test, type ElectronApplication } from '@playwright/test'
import { dropProfile, expectAxeClean, hook, launch, newProfile, studioPage } from './studio-app'

let app: ElectronApplication
let profile: string

test.beforeEach(async () => {
  profile = newProfile()
  app = await launch(profile)
  await hook(app, 'finishOnboarding')
})

test.afterEach(async () => {
  await app.close()
  dropProfile(profile)
})

test('Reading keeps Lens off until consent, then saves Lens settings', async () => {
  await hook(app, 'openStudio')
  const page = await studioPage(app)
  await page.getByRole('button', { name: 'Reading (Hoot Lens)' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Reading' })).toBeVisible()

  // Consent first: no switch until the user has read what is sent.
  await expect(page.getByText('Sent to Google Gemini')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Hoot Lens' })).toHaveCount(0)
  await expectAxeClean(page)
  await page.getByRole('button', { name: 'Turn on Hoot Lens' }).click()
  await expect(page.getByRole('switch', { name: 'Hoot Lens' })).toBeChecked()

  await page
    .getByRole('radiogroup', { name: 'Mode' })
    .getByText('Ask first', { exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Add a site' }).fill('https://www.example.com/page')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Site rules' })).toContainText('example.com')
  await expectAxeClean(page)

  await expect
    .poll(async () => {
      const lens = (await hook(app, 'getState')).settings?.settings.lens
      return [lens?.enabled, lens?.consentedAt !== null, lens?.mode, lens?.sites['example.com']]
    })
    .toEqual([true, true, 'ask', 'never'])
})

test('What Hoot knows about you and My glossary load from main and edit the profile', async () => {
  await hook(app, 'openStudio')
  const page = await studioPage(app)
  await page.getByRole('button', { name: 'Reading (Hoot Lens)' }).click()
  await page.getByRole('button', { name: /What Hoot knows about you/ }).click()

  await expect(
    page.getByRole('heading', { level: 1, name: 'What Hoot knows about you' })
  ).toBeVisible()
  await expect(page.locator('pre')).toContainText('Reader profile:')
  await expectAxeClean(page)

  // A word added here reaches main's profile and its summary.
  await page.getByRole('textbox', { name: 'Add a word you already know' }).fill('kubernetes')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Words' })).toContainText('kubernetes')
  await expect(page.locator('pre')).toContainText('kubernetes')

  await page.getByRole('button', { name: 'Back to Reading' }).click()
  await page.getByRole('button', { name: /My glossary/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'My glossary' })).toBeVisible()
  await expect(page.getByText('Your glossary is empty')).toBeVisible()
  await expectAxeClean(page)
})
