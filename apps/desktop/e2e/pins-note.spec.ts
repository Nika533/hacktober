import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
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

/** Sticky-note pins (C, F-C2): main/pins + renderer/note on the real app with fakes. */

let profile: string
let app: ElectronApplication

test.beforeEach(() => {
  profile = newProfile()
})

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  dropProfile(profile)
})

const ready = { onboardingDone: true, restorePins: true }

/** The card, with one finished fake answer; returns the buddy page and the answer's id. */
async function answer(text: string): Promise<{ buddy: Page; messageId: string }> {
  const buddy = await pageFor(app, 'buddy.html')
  await hook(app, 'summon')
  await hook(app, 'requestMode', 'card')
  await waitMode(app, 'card')
  await buddy.evaluate((t) => (window as unknown as HootWindow).hoot.chat.send({ text: t }), text)
  await expect
    .poll(async () => (await state(app)).chat.session?.messages.at(-1)?.status, { timeout: 15_000 })
    .toBe('done')
  const messageId = (await state(app)).chat.session?.messages.at(-1)?.id ?? ''
  return { buddy, messageId }
}

const notePages = (): Page[] => app.windows().filter((w) => w.url().includes('note.html'))

/** The note window showing `needle` (each note renders once its pin arrives). */
async function noteWith(needle: string): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      async () => {
        for (const p of notePages()) {
          const text = await p
            .locator('body')
            .innerText()
            .catch(() => '')
          if (text.includes(needle)) found = p
        }
        return found !== undefined
      },
      { timeout: 10_000 }
    )
    .toBe(true)
  return found!
}

test('pinning an answer opens a note with it; Esc closes the note and drops the pin', async () => {
  app = await launchHoot(profile, ready)
  const { buddy, messageId } = await answer('What is a residual?')
  await buddy.evaluate((id) => (window as unknown as HootWindow).hoot.pins.create(id), messageId)

  const note = await pageFor(app, 'note.html')
  await expect(note.locator('.note-body')).toContainText('your message')
  const pins = (await state(app)).pins.pins
  expect(pins).toHaveLength(1)
  expect(pins[0]).toMatchObject({ messageId })

  // Pinning the same answer again shows the same note.
  await buddy.evaluate((id) => (window as unknown as HootWindow).hoot.pins.create(id), messageId)
  expect((await state(app)).pins.pins).toHaveLength(1)

  // The note closes its own window, so the page goes away under the call.
  await note.keyboard.press('Escape').catch(() => undefined)
  await expect.poll(async () => (await state(app)).pins.pins.length).toBe(0)
  await expect.poll(() => notePages().length).toBe(0)
})

test('a note acts only on its own pin, and Open in Hoot brings its chat back', async () => {
  app = await launchHoot(profile, ready)
  const { buddy, messageId } = await answer('Explain heteroscedasticity')
  const sessionId = (await state(app)).chat.session?.id
  await buddy.evaluate((id) => (window as unknown as HootWindow).hoot.pins.create(id), messageId)
  await buddy.evaluate(() =>
    (window as unknown as HootWindow).hoot.pins.createFromText('**OLS**\n\nordinary least squares')
  )
  await expect.poll(() => notePages().length).toBe(2)

  const answerNote = await noteWith('your message')
  const textNote = await noteWith('ordinary least squares')

  // Leave the chat, then reopen it from the answer's note.
  await buddy.evaluate(() => (window as unknown as HootWindow).hoot.chat.newChat())
  await expect.poll(async () => (await state(app)).chat.session).toBeNull()
  await answerNote.evaluate(() => (window as unknown as HootWindow).hoot.pins.openInHoot())
  await expect.poll(async () => (await state(app)).chat.session?.id).toBe(sessionId)

  // Closing the text note leaves the answer's pin alone.
  await textNote
    .evaluate(() => (window as unknown as HootWindow).hoot.pins.close())
    .catch(() => undefined) // the window closes under the call
  await expect
    .poll(async () => (await state(app)).pins.pins.map((p) => p.messageId))
    .toEqual([messageId])
})

test('pinned text is deduplicated, and notes come back after a restart', async () => {
  app = await launchHoot(profile, ready)
  const buddy = await pageFor(app, 'buddy.html')
  const pinText = (): Promise<void> =>
    buddy.evaluate(() =>
      (window as unknown as HootWindow).hoot.pins.createFromText(
        '**API**\n\na way for programs to talk'
      )
    )
  await pinText()
  await pinText()
  await expect.poll(async () => (await state(app)).pins.pins.length).toBe(1)
  const note = await pageFor(app, 'note.html')
  await expect(note.locator('.note-body strong')).toHaveText('API')

  await app.close()
  app = await launchHoot(profile)
  const restored = await pageFor(app, 'note.html')
  await expect(restored.locator('.note-body')).toContainText('a way for programs to talk')
  expect((await state(app)).pins.pins).toHaveLength(1)
})
