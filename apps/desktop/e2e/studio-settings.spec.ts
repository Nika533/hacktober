import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
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

async function openSettings(): Promise<Page> {
  await hook(app, 'openStudio')
  const page = await studioPage(app)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  return page
}

test('Settings changes save at once and survive a restart', async () => {
  let page = await openSettings()
  await expectAxeClean(page)

  const model = page.getByRole('radiogroup', { name: 'Model' })
  await model.getByText('Flash-Lite', { exact: true }).click()
  const clip = page.getByRole('switch', { name: 'Suggest copied text' })
  await expect(clip).toBeChecked()
  await clip.focus()
  await page.keyboard.press('Space')
  await expect(clip).not.toBeChecked()

  await expect
    .poll(async () => {
      const s = (await hook(app, 'getState')).settings?.settings
      return [s?.model, s?.clipboardHint]
    })
    .toEqual(['gemini-3.5-flash-lite', false])

  // Quitting flushes settings to disk; a new process reads them back.
  await app.close()
  app = await launch(profile)
  page = await openSettings()
  await expect(
    page.getByRole('radiogroup', { name: 'Model' }).getByRole('radio', { name: /Flash-Lite/ })
  ).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Suggest copied text' })).not.toBeChecked()
})

test('Ctrl+, opens Settings and Back returns to the chat', async () => {
  await hook(app, 'openStudio')
  const page = await studioPage(app)
  await expect(page.getByText('What can I help with?')).toBeVisible()
  await expectAxeClean(page)
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to chat' }).click()
  await expect(page.getByText('What can I help with?')).toBeVisible()
})
