/**
 * Gate G2, desktop half (docs/finish-plan.md §3): demo steps 1–2 on the real
 * app from a fresh profile, once per run. Steps 3–5 happen in the browser
 * and are covered by the extension's demo e2e.
 *
 *   npm run build:e2e -w @hoot/desktop
 *   node scripts/gate-g2.mjs                 # fakes, no key, no network
 *   node scripts/gate-g2.mjs --live --runs 2 # real Claude (ANTHROPIC_API_KEY)
 *
 * 1. Onboarding takes a Claude API key (validated through settings.setApiKey),
 *    then the owl is summoned.
 * 2. A rectangle drawn on the capture overlay (a generated bar chart stands
 *    in for the screen) becomes an attachment; Explain streams an answer
 *    about it; the answer is pinned as a sticky note.
 *
 * Test mode registers no global hotkeys, so summon goes through the call
 * the hotkey makes.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { _electron as electron } from '@playwright/test'

const live = process.argv.includes('--live')
const runsArg = process.argv.indexOf('--runs')
const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 1
const key = live ? (process.env.ANTHROPIC_API_KEY ?? '') : 'fake-g2-key'
if (live && !key) {
  console.error('--live needs ANTHROPIC_API_KEY in the environment.')
  process.exit(1)
}

const TIMEOUT_MS = live ? 60_000 : 20_000
const root = join(import.meta.dirname, '..')
const desktop = join(root, 'apps/desktop')
const electronPath = createRequire(join(desktop, 'package.json'))('electron')

const results = []
const check = (run, step, ok, what) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} [run ${run}, ${step}] ${what}`)
}
const until = async (fn, ms = TIMEOUT_MS) => {
  const end = Date.now() + ms
  for (;;) {
    const value = await fn().catch(() => undefined)
    if (value) return value
    if (Date.now() > end) return undefined
    await new Promise((r) => setTimeout(r, 150))
  }
}

for (let run = 1; run <= runs; run++) await gate(run)

const failed = results.filter((r) => !r.ok).length
console.log(
  `G2 desktop (${live ? 'live Claude' : 'fakes'}, ${runs} run(s)): ${failed ? `${failed} check(s) failed` : 'passed'}`
)
process.exit(failed ? 1 : 0)

async function gate(run) {
  const work = mkdtempSync(join(tmpdir(), 'hoot-g2-'))
  writeFileSync(join(work, 'screen.png'), barChartPng(1280, 800))
  const env = {
    ...process.env,
    HOOT_TEST: '1',
    HOOT_USER_DATA: join(work, 'profile'),
    HOOT_BRIDGE_DIR: join(work, 'bridge'),
    HOOT_FAKE_CAPTURE: join(work, 'screen.png'),
    ...(live ? {} : { HOOT_FAKE_AI: '1', HOOT_FAKE_LENS: '1' })
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ANTHROPIC_API_KEY // the key must come through onboarding, like a fresh install
  const app = await electron.launch({
    executablePath: electronPath,
    args: [join(desktop, 'out/main/index.js')],
    cwd: desktop,
    env,
    timeout: TIMEOUT_MS
  })
  const state = () => app.evaluate(() => globalThis.__hoot.getState())
  const page = (name) =>
    until(async () => app.windows().find((w) => w.url().includes(`/${name}.html`)))
  try {
    // 1. Onboarding takes the key, then summon.
    const studio = await page('studio')
    const onboarding = await until(async () => (await state()).studio.view === 'onboarding')
    check(run, 1, Boolean(studio && onboarding), 'a fresh install opens onboarding')
    const saved = studio
      ? await studio.evaluate((k) => window.hoot.settings.setApiKey(k), key)
      : null
    check(
      run,
      1,
      saved?.ok === true,
      `the Claude API key is accepted${saved?.ok ? '' : ` (${saved?.reason ?? 'no reply'})`}`
    )
    await app.evaluate(() => globalThis.__hoot.finishOnboarding())
    await app.evaluate(() => globalThis.__hoot.summon())
    const summoned = await until(async () => ['pill', 'card'].includes((await state()).buddy.mode))
    check(run, 1, Boolean(summoned), 'summon shows the owl (via the hotkey path)')

    // 2. Circle a chart, Explain, the answer streams, pin it.
    const buddy = await page('buddy')
    await buddy.evaluate(() => window.hoot.capture.start('rect'))
    const overlay = await page('capture')
    await until(() => overlay.locator('.capture[data-state="open"]').isVisible())
    await overlay.mouse.move(100, 100)
    await overlay.mouse.down()
    await overlay.mouse.move(700, 500, { steps: 8 })
    await overlay.mouse.up()
    const attached = await until(async () => (await state()).chat.pendingAttachments.length === 1)
    check(run, 2, Boolean(attached), 'the circled region is attached to the chat')

    await app.evaluate(() => globalThis.__hoot.requestMode('card'))
    await buddy.evaluate(() => {
      window.__g2 = { first: 0 }
      window.hoot.chat.onDelta(() => {
        if (!window.__g2.first) window.__g2.first = performance.now()
      })
    })
    const sentAt = await buddy.evaluate(() => performance.now())
    await buddy.evaluate(() => window.hoot.chat.send({ quickAction: 'explain' }))
    const done = await until(async () => {
      const last = (await state()).chat.session?.messages.at(-1)
      return last?.role === 'assistant' && last.status !== 'streaming' ? last : undefined
    })
    const doneAt = await buddy.evaluate(() => performance.now())
    const firstAt = await buddy.evaluate(() => window.__g2.first)
    const ms = (t) => `${Math.round(t - sentAt)} ms`
    check(
      run,
      2,
      done?.status === 'done' && (done.text?.length ?? 0) > (live ? 80 : 0),
      `Explain answers about the capture: ${done?.status ?? 'no answer'}${done?.error ? ` (${done.error})` : ''}, ${done?.text?.length ?? 0} chars, first text after ${firstAt ? ms(firstAt) : '-'}, done after ${ms(doneAt)}`
    )
    const user = (await state()).chat.session?.messages.at(-2)
    check(run, 2, (user?.attachmentIds.length ?? 0) === 1, 'the capture went with the message')
    if (live && done?.text)
      console.log(`      answer: ${done.text.slice(0, 160).replace(/\s+/g, ' ')}…`)

    if (done?.id) await buddy.evaluate((id) => window.hoot.pins.create(id), done.id)
    const note = await page('note')
    const pinned = note
      ? await until(async () => (await note.locator('body').innerText()).length > 20)
      : false
    check(run, 2, Boolean(pinned), 'the answer is pinned as a sticky note')
  } catch (e) {
    check(run, '-', false, `gate crashed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await app.close().catch(() => undefined)
    rmSync(work, { recursive: true, force: true })
  }
}

/** A white canvas with four coloured bars and an axis: something to explain. */
function barChartPng(width, height) {
  const bars = [
    { x: 0.15, h: 0.35, c: [66, 133, 244] },
    { x: 0.35, h: 0.6, c: [219, 68, 55] },
    { x: 0.55, h: 0.45, c: [244, 180, 0] },
    { x: 0.75, h: 0.8, c: [15, 157, 88] }
  ]
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 250)
    row[0] = 0
    const fromBottom = (height * 0.85 - y) / (height * 0.7)
    for (let x = 0; x < width; x++) {
      const fx = x / width
      let c = null
      if (Math.abs(y - height * 0.85) < 2 && fx > 0.1 && fx < 0.9) c = [40, 40, 40]
      for (const b of bars)
        if (fx >= b.x && fx < b.x + 0.12 && fromBottom >= 0 && fromBottom <= b.h) c = b.c
      if (c) row.set(c, 1 + x * 3)
    }
    rows.push(row)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
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
