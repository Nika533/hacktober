import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HootApi, StateSlices } from '@hoot/core'

/** `window.hoot` inside `page.evaluate` (preload API; Node side has no DOM global). */
export type HootWindow = { hoot: HootApi }

/** Shared by the buddy-* specs: the real app on fakes, a throwaway profile. */

const MAIN = join(__dirname, '../../out/main/index.js')

export const newProfile = (): string => mkdtempSync(join(tmpdir(), 'hoot-buddy-'))
export const dropProfile = (dir: string): void => rmSync(dir, { recursive: true, force: true })

/** Seed `<userData>/hoot/settings.json`; fields not given fall back to defaults. */
export const seedSettings = (dir: string, seed: Record<string, unknown>): void => {
  mkdirSync(join(dir, 'hoot'), { recursive: true })
  writeFileSync(join(dir, 'hoot', 'settings.json'), JSON.stringify(seed))
}

export async function launchHoot(
  userData: string,
  seed?: Record<string, unknown>
): Promise<ElectronApplication> {
  if (seed !== undefined) seedSettings(userData, seed)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  // Devin/Windsurf hosts export this; Electron would run as plain Node.
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({
    args: [MAIN],
    env: {
      ...env,
      HOOT_TEST: '1',
      HOOT_FAKE_AI: '1',
      HOOT_FAKE_LENS: '1',
      HOOT_USER_DATA: userData
    }
  })
  await expect
    .poll(() => app.evaluate(() => globalThis.__hoot !== undefined), { timeout: 15_000 })
    .toBe(true)
  return app
}

type Hooks = NonNullable<typeof globalThis.__hoot>

/** Calls a main-process test hook (e2e build + HOOT_TEST only). */
export function hook<K extends keyof Hooks>(
  app: ElectronApplication,
  name: K,
  ...args: Parameters<Hooks[K]>
): Promise<ReturnType<Hooks[K]>> {
  return app.evaluate(
    (_e, [n, a]) => (globalThis.__hoot![n as keyof Hooks] as (...x: unknown[]) => unknown)(...a),
    [name, args] as const
  ) as Promise<ReturnType<Hooks[K]>>
}

// getState snapshots every slice, so the Partial<> is a lie in practice.
export const state = (app: ElectronApplication): Promise<StateSlices> =>
  hook(app, 'getState') as Promise<StateSlices>

/** The page for a renderer file, e.g. 'buddy.html'. */
export async function pageFor(app: ElectronApplication, page: string): Promise<Page> {
  const find = (): Page | undefined => app.windows().find((w) => w.url().includes(page))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const p = find()!
  await p.waitForLoadState('domcontentloaded')
  return p
}

export const waitMode = (app: ElectronApplication, mode: string): Promise<void> =>
  expect.poll(async () => (await state(app)).buddy.mode, { timeout: 5_000 }).toBe(mode)

/** Is the window whose URL contains `page` currently visible? */
export const windowVisible = (app: ElectronApplication, page: string): Promise<boolean> =>
  app.evaluate(
    ({ BrowserWindow }, url) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes(url))
        ?.isVisible() ?? false,
    page
  )

/** The primary display's work area in screen DIP. */
export const primaryWorkArea = (app: ElectronApplication): Promise<Electron.Rectangle> =>
  app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
