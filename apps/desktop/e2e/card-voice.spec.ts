import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { join } from 'node:path'
import { dropProfile, hook, newProfile, pageFor, state, type HootWindow } from './helpers/app'

/**
 * A voice chat in the Buddy card on the real app, with the scripted speech
 * engine (HOOT_FAKE_VOICE: it "hears" set phrases and says nothing aloud) and
 * the fake AI: mic → heard → sent → answered aloud → listening again → End.
 */

let app: ElectronApplication
let userData: string

test.beforeEach(async () => {
  userData = newProfile()
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
      HOOT_FAKE_VOICE: '1',
      HOOT_USER_DATA: userData
    }
  })
  await expect
    .poll(() => app.evaluate(() => globalThis.__hoot !== undefined), { timeout: 30_000 })
    .toBe(true)
})

test.afterEach(async () => {
  await app.close()
  dropProfile(userData)
})

async function openCard(): Promise<Page> {
  await hook(app, 'finishOnboarding')
  await hook(app, 'summon')
  const page = await pageFor(app, 'buddy.html')
  await page.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(page.locator('.hoot-buddy-card')).toBeVisible()
  return page
}

const phase = async (): Promise<string> => (await state(app)).voice.phase

test('the mic starts a voice chat: Hoot hears, sends, answers aloud and listens again', async () => {
  const page = await openCard()
  await page.getByRole('button', { name: 'Talk to Hoot' }).click()

  // It shows what it hears while listening.
  await expect(page.locator('.hoot-voice')).toContainText('What can you help me with?')
  await expect(page.getByRole('button', { name: 'Done talking' })).toBeVisible()

  // After the pause the question is sent, and the answer arrives in the card.
  const transcript = page.getByRole('log').or(page.locator('.hoot-buddy-card__transcript'))
  await expect(transcript).toContainText('What can you help me with?', { timeout: 10_000 })
  await expect.poll(phase, { timeout: 15_000 }).toMatch(/speaking|listening/)
  const sent = (await state(app)).chat.session?.messages.filter((m) => m.role === 'user') ?? []
  expect(sent[0]?.sentText).toContain('I said this aloud')

  // Spoken, then listening again for the next turn.
  await expect.poll(phase, { timeout: 15_000 }).toBe('listening')

  await page.getByRole('button', { name: 'End voice chat' }).click()
  await expect.poll(phase).toBe('off')
  await expect(page.locator('.hoot-voice')).toHaveCount(0)
})

test('Esc ends the voice chat before anything else', async () => {
  const page = await openCard()
  await page.getByRole('button', { name: 'Talk to Hoot' }).click()
  await expect.poll(phase).toBe('listening')
  await page.keyboard.press('Escape')
  await expect.poll(phase).toBe('off')
  expect((await state(app)).buddy.mode).toBe('card')
})

test('without spoken replies Hoot only listens; the setting persists', async () => {
  const page = await openCard()
  await page.evaluate(() =>
    (window as unknown as HootWindow).hoot.settings.update({ voiceReplies: false })
  )
  expect((await state(app)).settings.settings.voiceReplies).toBe(false)
  await page.getByRole('button', { name: 'Talk to Hoot' }).click()
  const transcript = page.locator('.hoot-buddy-card__transcript')
  await expect(transcript).toContainText('What can you help me with?', { timeout: 10_000 })
  // Straight back to listening: never 'speaking'.
  const seen = new Set<string>()
  await expect
    .poll(
      async () => {
        seen.add(await phase())
        return (await state(app)).chat.session?.messages.filter((m) => m.role === 'user').length
      },
      { timeout: 15_000, intervals: [50] }
    )
    .toBe(2)
  expect(seen.has('speaking')).toBe(false)
})
