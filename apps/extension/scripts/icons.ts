/**
 * Renders the extension icons (static/icons/icon-<size>.png) from one SVG:
 * the Lens owl in white on the Hoot accent. Run when the artwork changes:
 * `node scripts/icons.ts`.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ACCENT = '#2f6bd8'
const SIZES = [16, 32, 48, 128]

const svg = (size: number): string => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5.5" fill="${ACCENT}"/>
  <path d="M4 10c0-3.6 3.1-7 8-7s8 3.4 8 7v4c0 4.1-3.6 7-8 7s-8-2.9-8-7z"
    fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-width="1.5"/>
  <circle cx="8.6" cy="11.2" r="2.7" fill="#ffffff"/>
  <circle cx="15.4" cy="11.2" r="2.7" fill="#ffffff"/>
  <circle cx="8.6" cy="11.4" r="1.1" fill="${ACCENT}"/>
  <circle cx="15.4" cy="11.4" r="1.1" fill="${ACCENT}"/>
  <path d="M12 13.6l-1.4 2h2.8z" fill="#ffffff"/>
</svg>`

const out = join(dirname(fileURLToPath(import.meta.url)), '../static/icons')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`)
  await page
    .locator('svg')
    .screenshot({ path: join(out, `icon-${size}.png`), omitBackground: true })
}
await browser.close()
console.log(`static/icons: ${SIZES.map((size) => `icon-${size}.png`).join(', ')}`)
