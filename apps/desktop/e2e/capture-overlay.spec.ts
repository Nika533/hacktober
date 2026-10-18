import AxeBuilder from '@axe-core/playwright'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import type { Attachment, HootApi, StateSlices } from '@hoot/core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const MAIN = resolve(__dirname, '../out/main/index.js')

/** e2e code typechecks without the DOM lib; this is `window` in a renderer. */
type HootWindow = { hoot: HootApi }

type Rgb = readonly [number, number, number]
const RED: Rgb = [230, 40, 40]
const GREEN: Rgb = [40, 180, 80]
const BLUE: Rgb = [40, 90, 220]
const WHITE: Rgb = [250, 250, 250]

/** A tiny PNG encoder: the fake "screen" is four solid quadrants, so a crop's colour says where it came from. */
function quadrantsPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) {
      const colour = y < height / 2 ? (x < width / 2 ? RED : GREEN) : x < width / 2 ? BLUE : WHITE
      row.set(colour, 1 + x * 3)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

let app: ElectronApplication
let dir: string

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hoot-capture-'))
  writeFileSync(join(dir, 'screen.png'), quadrantsPng(64, 48))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env['ELECTRON_RUN_AS_NODE']
  Object.assign(env, {
    HOOT_TEST: '1',
    HOOT_FAKE_AI: '1',
    HOOT_FAKE_LENS: '1',
    HOOT_USER_DATA: join(dir, 'profile'),
    HOOT_FAKE_CAPTURE: join(dir, 'screen.png')
  })
  app = await electron.launch({ args: [MAIN], env })
})

test.afterEach(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

async function windowFor(page: string): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().endsWith(`/${page}`))).toBe(true)
  return app.windows().find((w) => w.url().endsWith(`/${page}`))!
}

const pending = (studio: Page): Promise<Attachment[]> =>
  studio.evaluate(async () => {
    const slices = (await (globalThis as unknown as HootWindow).hoot.state.subscribe([
      'chat'
    ])) as Pick<StateSlices, 'chat'>
    return slices.chat.pendingAttachments
  })

/** The colour of a saved attachment's centre pixel. */
const centre = (id: string): Promise<number[]> =>
  app.evaluate(
    ({ nativeImage }, path) => {
      const image = nativeImage.createFromPath(path)
      const { width, height } = image.getSize()
      const bgra = image
        .crop({ x: Math.floor(width / 2), y: Math.floor(height / 2), width: 1, height: 1 })
        .toBitmap()
      return [bgra[2]!, bgra[1]!, bgra[0]!]
    },
    join(dir, 'profile', 'hoot', 'attachments', `${id}.png`)
  )

async function startCapture(studio: Page, mode: 'lasso' | 'rect'): Promise<Page> {
  await studio.evaluate((m) => (globalThis as unknown as HootWindow).hoot.capture.start(m), mode)
  const overlay = await windowFor('capture.html')
  await expect(overlay.locator('.capture[data-state="open"]')).toBeVisible()
  return overlay
}

/** The display the overlay covers, in DIP. */
const displaySize = (overlay: Page): Promise<{ w: number; h: number }> =>
  overlay.evaluate(async () => {
    const init = await (globalThis as unknown as HootWindow).hoot.capture.getInit()
    return { w: init!.displayWidth, h: init!.displayHeight }
  })

async function wired(studio: Page): Promise<boolean> {
  return studio.evaluate(() =>
    (globalThis as unknown as HootWindow).hoot.capture.getInit().then(
      () => true,
      () => false
    )
  )
}

test('a rectangle around part of the screen becomes a capture in the composer', async () => {
  const studio = await windowFor('studio.html')
  test.skip(!(await wired(studio)), 'capture:* is not registered in AppContext yet (d1 wires it)')

  const overlay = await startCapture(studio, 'rect')
  await expect(overlay.getByRole('radio', { name: 'Rectangle' })).toBeChecked()
  await expect(overlay.getByText('Drag a rectangle')).toBeVisible()
  // Legacy mode: Electron can't open the blank page axe uses for frames.
  const { violations } = await new AxeBuilder({ page: overlay }).setLegacyMode(true).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
  await overlay.screenshot({ path: test.info().outputPath('capture-overlay.png') })

  // Top-left quadrant (red), whatever the runner's screen size.
  await overlay.mouse.move(40, 120)
  await overlay.mouse.down()
  await overlay.mouse.move(120, 180, { steps: 6 })
  await overlay.mouse.up()

  await expect(overlay.locator('.capture[data-state="closed"]')).toBeAttached()
  await expect.poll(async () => (await pending(studio)).length).toBe(1)
  const [capture] = await pending(studio)
  expect(capture).toMatchObject({ kind: 'capture' })
  expect(capture!.width / capture!.height).toBeCloseTo(80 / 60, 1)
  expect(capture!.thumbDataUrl).toMatch(/^data:image\/png;base64,/)
  expect(await centre(capture!.id)).toEqual([...RED])
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() && w.webContents.getURL().endsWith('/studio.html')
        )
      )
    )
    .toBe(true)
})

test('a lasso is cropped to what it circles; Esc and a stray click capture nothing', async () => {
  const studio = await windowFor('studio.html')
  test.skip(!(await wired(studio)), 'capture:* is not registered in AppContext yet (d1 wires it)')

  let overlay = await startCapture(studio, 'lasso')
  await overlay.keyboard.press('Escape')
  await expect(overlay.locator('.capture[data-state="closed"]')).toBeAttached()

  overlay = await startCapture(studio, 'lasso')
  await overlay.mouse.click(300, 300)
  await expect(overlay.locator('.capture[data-state="open"]')).toBeVisible()
  expect(await pending(studio)).toEqual([])

  // A triangle in the bottom-right quadrant (white).
  const size = await displaySize(overlay)
  const [x, y] = [size.w * 0.75, size.h * 0.75]
  await overlay.mouse.move(x - 40, y - 30)
  await overlay.mouse.down()
  await overlay.mouse.move(x + 40, y - 30, { steps: 8 })
  await overlay.mouse.move(x, y + 30, { steps: 8 })
  await overlay.mouse.move(x - 40, y - 30, { steps: 8 })
  await overlay.mouse.up()
  await expect.poll(async () => (await pending(studio)).length).toBe(1)
  expect(await centre((await pending(studio))[0]!.id)).toEqual([...WHITE])
})

test('F takes the whole screen', async () => {
  const studio = await windowFor('studio.html')
  test.skip(!(await wired(studio)), 'capture:* is not registered in AppContext yet (d1 wires it)')

  const overlay = await startCapture(studio, 'lasso')
  const size = await displaySize(overlay)
  await overlay.keyboard.press('f')
  await expect.poll(async () => (await pending(studio)).length).toBe(1)
  const [capture] = await pending(studio)
  expect(capture!.width / capture!.height).toBeCloseTo(size.w / size.h, 1)
  expect(Math.max(capture!.width, capture!.height)).toBeLessThanOrEqual(1568)
})
