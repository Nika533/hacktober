/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Screenshots of the gallery (light, dark, high contrast) plus an axe pass.
// Usage: npm.cmd run shots   (from packages/ui). Writes screenshots/*.png and
// exits non-zero on any axe violation.
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../screenshots')
await mkdir(out, { recursive: true })

const server = await createServer({
  configFile: resolve(here, '../dev/vite.config.ts'),
  server: { port: 0, strictPort: false },
  logLevel: 'warn'
})
await server.listen()
const base = server.resolvedUrls?.local[0]
if (!base) throw new Error('vite did not report a URL')

const variants = [
  { name: 'light', theme: 'light', media: { colorScheme: 'light' }, axe: true },
  { name: 'dark', theme: 'dark', media: { colorScheme: 'dark' }, axe: true },
  { name: 'high-contrast', theme: 'dark', media: { colorScheme: 'dark', forcedColors: 'active' } },
  { name: 'more-contrast', theme: 'light', media: { colorScheme: 'light', contrast: 'more' } }
]

// Playwright's Chromium when downloaded, else the system Edge (always on Windows).
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }))
const failures = []

async function axe(page, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  for (const v of violations) {
    failures.push(`${label}: ${v.id} (${v.impact}) ${v.help}`)
    for (const n of v.nodes.slice(0, 5))
      failures.push(`    ${n.target.join(' ')} — ${n.failureSummary?.split('\n')[1] ?? ''}`)
  }
}

try {
  for (const v of variants) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    // Reduced motion keeps the owl still so shots are deterministic.
    await page.emulateMedia({ reducedMotion: 'reduce', ...v.media })
    await page.goto(`${base}#/gallery?theme=${v.theme}`)
    await page.getByRole('heading', { name: 'Hoot UI' }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(out, `gallery-${v.name}.png`), fullPage: true })
    if (v.axe) await axe(page, v.name)

    if (v.axe) {
      // Overlays: keyboard tooltip, then the destructive confirm.
      await page.keyboard.press('Tab')
      await page.getByRole('button', { name: 'Open in Studio' }).focus()
      await page.locator('.hoot-tooltip').waitFor()
      const section = page.locator('section', {
        has: page.getByRole('heading', { name: 'Icon buttons' })
      })
      await section.screenshot({ path: resolve(out, `tooltip-${v.name}.png`) })

      await page.getByRole('button', { name: 'Clear all data…' }).click()
      await page.getByRole('alertdialog').waitFor()
      await page.waitForTimeout(400)
      await page.screenshot({ path: resolve(out, `dialog-${v.name}.png`) })
      await axe(page, `${v.name} + dialog`)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Delete with undo' }).click()
      await page.getByText('Chat deleted').waitFor()
      await page.waitForTimeout(400)
      await page.screenshot({
        path: resolve(out, `toast-${v.name}.png`),
        clip: { x: 340, y: 760, width: 600, height: 140 }
      })
    }
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}

if (failures.length) {
  console.error(`axe found ${failures.length} problem line(s):\n` + failures.join('\n'))
  process.exit(1)
}
console.log(`Screenshots in ${out}; axe clean.`)
