import AxeBuilder from '@axe-core/playwright'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Shared by the studio-* specs: the real app on fakes, a throwaway profile. */

export const newProfile = (): string => mkdtempSync(join(tmpdir(), 'hoot-studio-'))
export const dropProfile = (dir: string): void => rmSync(dir, { recursive: true, force: true })

export async function launch(userData: string): Promise<ElectronApplication> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  // Devin/Windsurf hosts export this; Electron would run as plain Node.
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({
    args: [join(__dirname, '../out/main/index.js')],
    env: {
      ...env,
      HOOT_TEST: '1',
      HOOT_FAKE_AI: '1',
      HOOT_FAKE_LENS: '1',
      HOOT_USER_DATA: userData
    }
  })
  // Several Electrons start at once on CI; the first launch can take a while.
  await expect
    .poll(() => app.evaluate(() => globalThis.__hoot !== undefined), { timeout: 30_000 })
    .toBe(true)
  return app
}

type Hooks = NonNullable<typeof globalThis.__hoot>
type NoArgHook = { [K in keyof Hooks]: Parameters<Hooks[K]> extends [] ? K : never }[keyof Hooks]

/** Calls a main-process test hook (e2e build + HOOT_TEST only). */
export const hook = <K extends NoArgHook>(
  app: ElectronApplication,
  name: K
): Promise<ReturnType<Hooks[K]>> =>
  app.evaluate((_e, n) => (globalThis.__hoot![n] as () => ReturnType<Hooks[K]>)(), name)

export async function studioPage(app: ElectronApplication): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().includes('studio.html'))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const page = find()!
  await page.waitForLoadState('domcontentloaded')
  return page
}

/**
 * WCAG 2.2 AA through axe, on whatever Studio shows right now. Colour
 * contrast is left to the gallery's axe pass (ui-shots): Studio's page is
 * transparent over Mica, which axe can't see, so it measures against white.
 */
export async function expectAxeClean(page: Page): Promise<void> {
  // Legacy mode runs in the page itself: Electron can't open the blank page axe wants.
  const { violations } = await new AxeBuilder({ page })
    .setLegacyMode(true)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(['color-contrast'])
    .analyze()
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  ).toEqual([])
}
