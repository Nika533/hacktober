import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { dropProfile, hook, launchHoot, newProfile, pageFor, state } from './helpers/app'

/**
 * Agents on the real app (fake AI): the card calls one, it answers in its own
 * window while the owl's chat stays as it was, two answer at once, and each
 * minimizes into an owl of its own colour and opens again.
 */

let app: ElectronApplication
let userData: string

test.beforeEach(async () => {
  userData = newProfile()
  app = await launchHoot(userData)
  await hook(app, 'finishOnboarding')
})

test.afterEach(async () => {
  await app.close()
  dropProfile(userData)
})

async function openCard(): Promise<Page> {
  await hook(app, 'summon')
  const buddy = await pageFor(app, 'buddy.html')
  await expect(buddy.getByRole('toolbar', { name: 'Hoot' })).toBeVisible()
  await buddy.getByRole('button', { name: 'Chat', exact: true }).click()
  await expect(buddy.locator('.hoot-buddy-card')).toBeVisible()
  return buddy
}

const agentPages = (): Page[] => app.windows().filter((w) => w.url().includes('agent.html'))

async function agentPage(index: number): Promise<Page> {
  await expect.poll(() => agentPages().length, { timeout: 15_000 }).toBeGreaterThan(index)
  const page = agentPages()[index]!
  await page.waitForLoadState('domcontentloaded')
  return page
}

const windowSize = (url: string): Promise<number[]> =>
  app.evaluate(
    ({ BrowserWindow }, part) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes(part))
        ?.getSize() ?? [],
    url
  )

test('an agent answers in its own window, beside the owl’s chat', async () => {
  const buddy = await openCard()
  await buddy.getByRole('button', { name: 'New agent, working alongside this chat' }).click()
  const agent = await agentPage(0)
  await expect(agent.getByRole('heading', { name: 'Blue agent' })).toBeVisible()
  await expect(agent.locator('.hoot-agent-card__owl .hoot-owl')).toHaveAttribute(
    'data-tint',
    'blue'
  )

  const box = agent.getByRole('textbox', { name: 'Message Blue agent' })
  await box.fill('Plan my week')
  await box.press('Enter')
  await expect(agent.locator('.hoot-msg--assistant').last()).not.toBeEmpty()
  await expect(agent.getByRole('button', { name: 'Regenerate' })).toBeVisible({ timeout: 15_000 })

  const s = await state(app)
  expect(s.agents.list).toHaveLength(1)
  expect(s.agents.list[0]?.session?.messages[0]?.text).toBe('Plan my week')
  // The owl's own chat didn't get the agent's message; Studio's list did.
  expect(s.chat.session).toBeNull()
  expect(s.sessions.list.map((m) => m.title)).toContain('Plan my week')
})

test('two agents answer at once; each minimizes into its own coloured owl and opens again', async () => {
  const buddy = await openCard()
  const call = buddy.getByRole('button', { name: 'New agent, working alongside this chat' })
  await call.click()
  await call.click()
  const blue = await agentPage(0)
  const green = await agentPage(1)
  await expect(green.getByRole('heading', { name: 'Green agent' })).toBeVisible()

  for (const [page, name, text] of [
    [blue, 'Blue agent', 'First task'],
    [green, 'Green agent', 'Second task']
  ] as const) {
    const box = page.getByRole('textbox', { name: `Message ${name}` })
    await box.fill(text)
    await box.press('Enter')
  }
  await expect
    .poll(async () => (await state(app)).agents.list.filter((a) => a.stream !== null).length)
    .toBe(2)
  await expect
    .poll(async () => (await state(app)).agents.list.every((a) => a.stream === null), {
      timeout: 20_000
    })
    .toBe(true)

  await green.getByRole('button', { name: 'Minimize to its owl' }).click()
  const owl = green.getByRole('button', { name: 'Open Green agent' })
  await expect(owl).toBeVisible()
  await expect(owl.locator('.hoot-owl')).toHaveAttribute('data-tint', 'green')
  await expect.poll(async () => (await state(app)).agents.list[1]?.minimized).toBe(true)
  expect((await windowSize(green.url()))[0]).toBeLessThan(100)

  await owl.click()
  await expect(green.getByRole('heading', { name: 'Second task' })).toBeVisible()
  expect((await windowSize(green.url()))[0]).toBeGreaterThan(300)

  await blue.getByRole('button', { name: 'Close Blue agent' }).click()
  await expect
    .poll(async () => (await state(app)).agents.list.map((a) => a.color))
    .toEqual(['green'])
  await expect.poll(() => agentPages().length).toBe(1)
})
