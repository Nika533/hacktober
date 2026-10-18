/**
 * Gate G1 (docs/finish-plan.md §3): the app runs on the fakes, from a fresh
 * profile. Drives the e2e build through Playwright and the main-process test
 * hooks (HOOT_TEST=1), and prints one line per check.
 *
 *   npm run build:e2e -w @hoot/desktop && npm run build -w @hoot/bridge
 *   node scripts/gate-g1.mjs
 *
 * Test mode registers no global hotkeys, so the hotkey steps go through the
 * same main-process calls the hotkeys make (summon, open Studio). Step 5
 * talks to the running app through hoot-bridge exactly as the browser does;
 * the extension's own UI is covered by its e2e suite.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

const TIMEOUT_MS = 20_000
/** core's BRIDGE_PROTOCOL_VERSION and DEV_EXTENSION_ID */
const PROTOCOL = 1
const ORIGIN = 'chrome-extension://angnmpllmankipgoikeahfhidpcjninj/'

const root = join(import.meta.dirname, '..')
const desktop = join(root, 'apps/desktop')
const electronPath = createRequire(join(desktop, 'package.json'))('electron')
const work = mkdtempSync(join(tmpdir(), 'hoot-g1-'))
const env = {
  ...process.env,
  HOOT_TEST: '1',
  HOOT_FAKE_AI: '1',
  HOOT_FAKE_LENS: '1',
  HOOT_USER_DATA: join(work, 'profile'),
  HOOT_BRIDGE_DIR: join(work, 'bridge')
}
delete env.ELECTRON_RUN_AS_NODE

const results = []
const check = (step, ok, what) => {
  results.push({ step, ok, what })
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${step}] ${what}`)
}

const launch = () =>
  electron.launch({
    executablePath: electronPath,
    args: [join(desktop, 'out/main/index.js')],
    cwd: desktop,
    env,
    timeout: TIMEOUT_MS
  })
const state = (app) => app.evaluate(() => globalThis.__hoot.getState())
const until = async (fn, ms = TIMEOUT_MS) => {
  const end = Date.now() + ms
  for (;;) {
    const value = await fn().catch(() => undefined)
    if (value) return value
    if (Date.now() > end) return undefined
    await new Promise((r) => setTimeout(r, 200))
  }
}
const windowFor = (app, page) =>
  until(async () => app.windows().find((w) => w.url().includes(`/${page}.html`)))

const MESSAGE = 'G1 says hello'

try {
  // 1. Onboarding, then the owl as a dot.
  let app = await launch()
  const studio = await windowFor(app, 'studio')
  const onboarding = await until(async () => (await state(app)).studio.view === 'onboarding')
  check(1, Boolean(studio) && Boolean(onboarding), 'first run opens Studio on onboarding')
  await app.evaluate(() => globalThis.__hoot.finishOnboarding())
  const pill = await until(async () => (await state(app)).buddy.mode === 'pill')
  check(1, Boolean(pill), 'onboarding ends on the pill')
  // The pill focuses itself (to type) and never collapses while focused, as in
  // legacy. The user going back to their work is a blur.
  const buddy = await windowFor(app, 'buddy')
  // focus() lands asynchronously; blurring before it does would be undone by it.
  await until(
    () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.webContents.getURL().includes('/buddy.html') && w.isFocused()
        )
      ),
    3000
  )
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows())
      if (w.webContents.getURL().includes('/buddy.html')) w.blur()
  })
  const dot = await until(async () => (await state(app)).buddy.mode === 'dot', 30_000)
  check(
    1,
    Boolean(dot) && Boolean(buddy),
    'once the user clicks elsewhere, the pill collapses to a dot'
  )

  // 2. Summon, open the card, and a message streams.
  await app.evaluate(() => globalThis.__hoot.summon())
  await app.evaluate(() => globalThis.__hoot.requestMode('card'))
  const card = await until(async () => (await state(app)).buddy.mode === 'card')
  check(2, Boolean(card), 'summon opens the card (via the hotkey path; hotkeys are F-D1-2)')
  let sawDelta = false
  if (buddy) {
    await buddy.evaluate(() => {
      window.__g1Deltas = 0
      window.hoot.chat.onDelta(() => window.__g1Deltas++)
    })
    await buddy.evaluate((text) => window.hoot.chat.send({ text }), MESSAGE)
    sawDelta = Boolean(await until(async () => (await buddy.evaluate(() => window.__g1Deltas)) > 0))
  }
  const answered = await until(async () => {
    const s = (await state(app)).chat.session
    return s?.messages.at(-1)?.status === 'done' ? s : undefined
  })
  check(2, sawDelta, 'the card receives chat:delta while the answer streams')
  check(2, Boolean(answered), `the answer finishes (${answered?.messages.length ?? 0} messages)`)
  const shown = buddy
    ? await until(async () => (await buddy.locator('body').innerText()).includes('your message'))
    : false
  check(2, Boolean(shown), 'the streamed answer is visible in the card')

  // 3. Studio lists the session.
  await app.evaluate(() => globalThis.__hoot.openStudio())
  const listed = studio
    ? await until(async () => (await studio.locator('body').innerText()).includes(MESSAGE))
    : false
  check(3, Boolean(listed), 'Studio lists the session')

  // 4. Settings (and the session) survive a restart.
  await app.evaluate(() => globalThis.__hoot.updateSettings({ translateTo: 'German' }))
  await app.close()
  app = await launch()
  const after = await until(async () => {
    const s = await state(app)
    return s.settings ? s : undefined
  })
  check(
    4,
    after?.settings.settings.translateTo === 'German',
    'a changed setting survives a restart'
  )
  check(4, after?.settings.settings.onboardingDone === true, 'onboarding stays done')
  check(4, (after?.sessions.list.length ?? 0) === 1, 'the session survives a restart')

  // 5. The browser path through the real bridge, with the fake Lens. Lens is
  // off until the user consents in Studio → Reading, as in the demo.
  await app.evaluate(() =>
    globalThis.__hoot.updateSettings({ lens: { enabled: true, consentedAt: Date.now() } })
  )
  const replies = await talkThroughBridge([
    { type: 'hello', reqId: 'g1-hello', protocol: PROTOCOL, extVersion: 'g1', browser: 'chrome' },
    {
      type: 'rewrite',
      reqId: 'g1-rewrite',
      ctx: lensContext('heteroscedasticity'),
      allowedTransforms: ['define', 'expand'],
      risk: 'normal'
    }
  ])
  check(5, replies.get('g1-hello')?.type === 'welcome', 'hoot-bridge → app: welcome')
  const rewrite = replies.get('g1-rewrite')
  check(
    5,
    rewrite?.type === 'rewritten',
    `Ask-first rewrite through the bridge → ${rewrite?.type ?? 'no reply'}${rewrite?.result?.text ? `: "${rewrite.result.text}"` : ''}${rewrite?.reason ? ` (${rewrite.reason})` : ''}`
  )
  await app.close()
} catch (e) {
  check('-', false, `gate crashed: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `G1: ${failed.length} check(s) failed` : 'G1 passed')
process.exit(failed.length ? 1 : 0)

function lensContext(span) {
  return {
    span,
    paragraph: `The residual plot shows ${span}, so the standard errors are unreliable.`,
    headingPath: ['Checking the model'],
    title: 'A gentle guide to linear regression',
    lang: 'en',
    site: 'example.com',
    siteCategory: 'general',
    surface: 'html',
    signals: {
      sizeClass: 'term',
      copiedWithinMs: null,
      dwellMs: 1800,
      reselectCount: 0,
      reread: 0,
      rarity: 0.9,
      knownTerm: false,
      topicFamiliarity: null,
      foreignLanguage: false,
      blocked: null
    },
    p: 0.85
  }
}

/** hoot-bridge (the built dev host) with native-messaging frames; replies by reqId. */
function talkThroughBridge(requests) {
  const host = spawn(
    process.execPath,
    [join(root, 'packages/bridge/dist/hoot-bridge.cjs'), ORIGIN],
    {
      env: { ...process.env, HOOT_BRIDGE_DIR: env.HOOT_BRIDGE_DIR }
    }
  )
  const replies = new Map()
  let buffer = Buffer.alloc(0)
  let stderr = ''
  host.stderr.on('data', (d) => (stderr += d))
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      host.stdin.end()
      if (replies.size < requests.length && stderr) console.log(stderr.trim())
      resolve(replies)
    }
    const timer = setTimeout(finish, TIMEOUT_MS)
    host.on('exit', finish)
    host.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0)
        if (buffer.length < 4 + length) break
        const message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'))
        buffer = buffer.subarray(4 + length)
        if (typeof message.reqId === 'string') replies.set(message.reqId, message)
        if (replies.size === requests.length) finish()
      }
    })
    for (const request of requests) {
      const body = Buffer.from(JSON.stringify(request), 'utf8')
      const header = Buffer.alloc(4)
      header.writeUInt32LE(body.length, 0)
      host.stdin.write(Buffer.concat([header, body]))
    }
  })
}
