/* eslint-disable @typescript-eslint/explicit-function-return-type */
// One-off: launch Hoot, run a lasso drag on the overlay, dump state + console.
import { _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const userData = mkdtempSync(path.join(tmpdir(), 'hoot-dbg-'))
const env = {
  ...process.env,
  HOOT_TEST: '1',
  HOOT_FAKE_AI: '1',
  HOOT_USER_DATA: userData,
  HOOT_FAKE_CAPTURE: path.resolve('e2e', 'fixtures', 'screen.png')
}
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ args: ['.'], env })
let overlay
for (let i = 0; i < 40 && !overlay; i++) {
  overlay = app.windows().find((w) => w.url().includes('overlay.html'))
  if (!overlay) await new Promise((r) => setTimeout(r, 250))
}
overlay.on('console', (m) => console.log('[overlay]', m.type(), m.text()))
overlay.on('pageerror', (e) => console.log('[overlay-pageerror]', e.message))

const call = (fn, arg) =>
  app.evaluate(
    (_e, p) => {
      const h = globalThis.__hoot
      return h[p.fn](p.arg)
    },
    { fn, arg }
  )
const getState = () => app.evaluate(() => globalThis.__hoot.getState())

await new Promise((r) => setTimeout(r, 1200))
await call('finishOnboarding')
await new Promise((r) => setTimeout(r, 800))
await call('updateSettings', { collapseToDotAfterMs: 300000 })
await call('requestMode', 'card')
await new Promise((r) => setTimeout(r, 800))

await call('startCapture', 'lasso')
await overlay.waitForSelector('.overlay-shot', { timeout: 10000 })
console.log('overlay up, display =', await overlay.evaluate(() => innerWidth + 'x' + innerHeight))

await overlay.mouse.move(1500, 500)
await overlay.mouse.down()
await overlay.mouse.move(1700, 420, { steps: 3 })
await overlay.mouse.move(1850, 650, { steps: 3 })
await overlay.mouse.move(1750, 900, { steps: 3 })
await overlay.mouse.move(1520, 820, { steps: 3 })

const dbg = await overlay.evaluate(() => {
  const el = document.querySelector('.overlay-root')
  return { hasRoot: !!el, pointerEvents: el ? getComputedStyle(el).pointerEvents : null }
})
console.log('overlay-root:', JSON.stringify(dbg))

await overlay.mouse.up()
await new Promise((r) => setTimeout(r, 1500))
const s = await getState()
console.log('pending:', s.pendingAttachments.length, 'buddyMode:', s.buddyMode)

await app.close()
