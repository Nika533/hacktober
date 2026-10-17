/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Desktop verification: real desktopCapturer overlay + Studio material/theme check.
// - launches the built app (no HOOT_FAKE_CAPTURE → real desktopCapturer)
// - collects console errors from every window
// - finishOnboarding → openStudio → full-window desktop screenshots in light AND
//   dark theme (themeSource hook) → studio-desktop-{light,dark}.png
// - startCapture → polls overlay.isVisible() + an active capture from main →
//   full-screen CopyFromScreen → real-capture.png → Esc cancel
// CopyFromScreen uses PHYSICAL pixels — DIP bounds are multiplied by scaleFactor.
import { _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SHOTS = path.join('test-results', 'e2e')
mkdirSync(SHOTS, { recursive: true })

const userData = mkdtempSync(path.join(tmpdir(), 'hoot-desk-'))
const env = {
  ...process.env,
  HOOT_TEST: '1',
  HOOT_FAKE_AI: '1',
  HOOT_USER_DATA: userData
}
delete env.ELECTRON_RUN_AS_NODE

const consoleErrors = []
const app = await electron.launch({ args: ['.'], env })
app.on('window', (p) => {
  p.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${p.url()}: ${m.text()}`)
  })
  p.on('pageerror', (e) => consoleErrors.push(`${p.url()}: ${e.message}`))
})

const pageFor = async (match) => {
  for (let i = 0; i < 80; i++) {
    const p = app.windows().find((w) => w.url().includes(match))
    if (p) return p
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`window ${match} not found`)
}
const call = (fn, arg) => app.evaluate((_e, p) => globalThis.__hoot[p.fn](p.arg), { fn, arg })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// OS-level visibility of a window (hide() can't be faked by the renderer).
const winVisible = (match) =>
  app.evaluate((e, m) => {
    const w = e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(m))
    return !!w && w.isVisible()
  }, match)

async function waitFor(desc, fn, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true
    await sleep(120)
  }
  throw new Error(`timeout waiting for ${desc}`)
}

function desktopShot(x, y, w, h, out) {
  const ps = `
Add-Type -AssemblyName System.Drawing
$b = New-Object System.Drawing.Bitmap ${w}, ${h}
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen(${x}, ${y}, 0, 0, (New-Object System.Drawing.Size ${w}, ${h}))
$b.Save('${out.replace(/\\/g, '\\\\').replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $b.Dispose()
`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  if (r.status !== 0) console.log('PS screenshot failed:', r.stderr || r.stdout)
}

// DIP bounds → physical pixels for CopyFromScreen.
const shotWindow = async (match, out) => {
  const { b, scale } = await app.evaluate((e, m) => {
    const w = e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(m))
    const b = w.getBounds()
    const scale = e.screen.getDisplayNearestPoint({ x: b.x + 1, y: b.y + 1 }).scaleFactor
    return { b, scale }
  }, match)
  const px = {
    x: Math.round(b.x * scale),
    y: Math.round(b.y * scale),
    w: Math.round(b.width * scale),
    h: Math.round(b.height * scale)
  }
  console.log(`${match} bounds (DIP):`, JSON.stringify(b), 'scale:', scale)
  desktopShot(px.x, px.y, px.w, px.h, path.resolve(SHOTS, out))
  console.log(`wrote ${out}`)
}

await pageFor('buddy.html')
const overlayPage = await pageFor('overlay.html')
await pageFor('studio.html')
await sleep(1500)
await call('finishOnboarding')
await sleep(800)
await call('updateSettings', { collapseToDotAfterMs: 300000 })

// ---- Studio material: light then dark --------------------------------------
await call('openStudio', 'chat')
await sleep(1200)
// Windows may refuse the focus steal — pin Studio above other windows while we
// shoot, then restore normal z-ordering.
await app.evaluate((e) => {
  const w = e.BrowserWindow.getAllWindows().find((x) =>
    x.webContents.getURL().includes('studio.html')
  )
  w.setAlwaysOnTop(true, 'pop-up-menu')
  w.moveTop()
  w.focus()
})
await sleep(400)
await call('setThemeSource', 'light')
await sleep(1200) // themeSource → nativeTheme 'updated' → state broadcast → repaint
await shotWindow('studio.html', 'studio-desktop-light.png')
await call('setThemeSource', 'dark')
await sleep(1200)
// A theme switch re-themes the native frame; re-assert z-order before shooting
// and log what the OS thinks of the window so a bad shot is diagnosable.
const studioInfo = await app.evaluate((e) => {
  const w = e.BrowserWindow.getAllWindows().find((x) =>
    x.webContents.getURL().includes('studio.html')
  )
  w.setAlwaysOnTop(true, 'pop-up-menu')
  w.moveTop()
  return {
    visible: w.isVisible(),
    minimized: w.isMinimized(),
    onTop: w.isAlwaysOnTop(),
    bounds: w.getBounds(),
    dark: e.nativeTheme.shouldUseDarkColors
  }
})
console.log('studio before dark shot:', JSON.stringify(studioInfo))
await sleep(500)
await shotWindow('studio.html', 'studio-desktop-dark.png')
await call('setThemeSource', 'system')
await app.evaluate((e) => {
  const w = e.BrowserWindow.getAllWindows().find((x) =>
    x.webContents.getURL().includes('studio.html')
  )
  w.setAlwaysOnTop(false)
})

// ---- real capture overlay ---------------------------------------------------
await call('lockStudio')
await sleep(400)
await call('requestMode', 'card')
await sleep(600)
await call('startCapture')
// Honest gating: OS-visible window AND an active capture AND the shot mounted
// (the renderer now unmounts it whenever the overlay is hidden).
await waitFor('overlay window visible', () => winVisible('overlay.html'))
await waitFor('active capture', () => call('isCapturing'))
await overlayPage.waitForSelector('.overlay-root[data-state="open"] .overlay-shot', {
  timeout: 15000
})
await overlayPage.waitForSelector('.overlay-toolbar', { timeout: 5000 })
await sleep(500) // let the image + veil paint
// The overlay covers the display under the cursor — shoot its own bounds.
await shotWindow('overlay.html', 'real-capture.png')
await overlayPage.keyboard.press('Escape')
await waitFor('overlay hidden', async () => !(await winVisible('overlay.html')))

console.log('console errors:', consoleErrors.length ? consoleErrors : 'none')
await app.close()
