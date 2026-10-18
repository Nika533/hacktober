// Browser check of pdf-view on the fixture: renders pages, verifies the text
// layer is selectable and lines up with the canvas, zooms, switches to
// reflow, runs axe on both modes and writes screenshots/*.png.
// Usage: npm.cmd run shots (from packages/pdf-view). Exits non-zero on failure.
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

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' }))
const failures = []
const check = (ok, msg) => {
  if (!ok) failures.push(msg)
}

async function axe(page, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  for (const v of violations) {
    const n = v.nodes[0]
    failures.push(
      `${label}: ${v.id} (${v.impact}) ${v.help} — ${n?.target.join(' ')}: ${n?.failureSummary}`
    )
  }
}

try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.goto(`${base}?theme=${theme}`)
    await page.locator('body[data-ready="true"]').waitFor()
    const firstText = page.locator('.hoot-pdf-page[data-page="1"] .hoot-pdf-text span').first()
    await firstText.waitFor()
    await page.waitForTimeout(300)

    // The text layer carries the page's words and can be selected.
    const selected = await page.evaluate(() => {
      const layer = document.querySelector('.hoot-pdf-page[data-page="1"] .hoot-pdf-text')
      const range = document.createRange()
      range.selectNodeContents(layer)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      const text = sel.toString()
      sel.removeAllRanges()
      return text
    })
    check(selected.includes('heteroscedasticity'), `${theme}: text layer lacks the page text`)

    // Each text run must sit on top of its glyphs: compare the title span's
    // box with where the fixture drew it (x=72pt, baseline 720pt, 24pt).
    const geo = await page.evaluate(() => {
      const pageEl = document.querySelector('.hoot-pdf-page[data-page="1"]')
      const span = [...pageEl.querySelectorAll('.hoot-pdf-text span')].find((s) =>
        s.textContent.startsWith('Reading Regression Output')
      )
      const p = pageEl.getBoundingClientRect()
      const r = span.getBoundingClientRect()
      return { scale: p.width / 612, left: r.left - p.left, top: r.top - p.top, height: r.height }
    })
    const expectLeft = 72 * geo.scale
    check(
      Math.abs(geo.left - expectLeft) < 3,
      `${theme}: title span x ${geo.left} vs ${expectLeft}`
    )
    const baseline = (792 - 720) * geo.scale
    check(
      geo.top < baseline && geo.top > baseline - 30 * geo.scale,
      `${theme}: title span top ${geo.top} not just above baseline ${baseline}`
    )

    const overflow = await page.evaluate(() => {
      const v = document.querySelector('.hoot-pdf')
      return v.scrollWidth - v.clientWidth
    })
    check(overflow <= 0, `${theme}: fit-width overflows horizontally by ${overflow}px`)

    await page.screenshot({ path: resolve(out, `pages-${theme}.png`) })
    await axe(page, `${theme} pages`)

    if (theme === 'light') {
      // Debug view: paint the invisible text layer to show it tracks the glyphs.
      await page.addStyleTag({
        content: '.hoot-pdf-text span { color: rgb(220 0 0 / 0.55) !important; }'
      })
      await page.locator('.hoot-pdf-page[data-page="1"]').screenshot({
        path: resolve(out, 'text-layer-overlay.png'),
        clip: { x: 0, y: 0, width: 700, height: 420 }
      })
      await page.evaluate(() => document.querySelector('style:last-of-type')?.remove())

      // Zoom re-renders sharp and keeps the text layer in step.
      await page.getByRole('button', { name: 'Zoom in' }).click()
      await page.waitForTimeout(600)
      const zoomed = await page.evaluate(() => {
        const pageEl = document.querySelector('.hoot-pdf-page[data-page="1"]')
        const canvas = pageEl.querySelector('canvas')
        return { css: pageEl.getBoundingClientRect().width, px: canvas.width }
      })
      check(
        zoomed.px >= Math.floor(zoomed.css),
        `zoom: canvas ${zoomed.px}px for ${zoomed.css}px box`
      )
      await page.getByRole('button', { name: 'Fit width' }).click()
    }

    await page.getByRole('button', { name: 'Text only' }).click()
    await page.locator('.hoot-pdf-reflow h2').waitFor()
    const headings = await page.locator('.hoot-pdf-reflow :is(h2, h3)').allTextContents()
    check(
      headings.join('|') ===
        'Reading Regression Output|What the residuals tell you|Fixing it|When to worry',
      `${theme}: reflow headings ${headings.join('|')}`
    )
    check(
      (await page.locator('.hoot-pdf-reflow').textContent()).includes('confidence intervals'),
      `${theme}: reflow did not rejoin "confi-dence"`
    )
    await page.screenshot({ path: resolve(out, `reflow-${theme}.png`) })
    await axe(page, `${theme} reflow`)
    check(errors.length === 0, `${theme}: page errors ${errors.join('; ')}`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}

if (failures.length) {
  console.error(`${failures.length} problem(s):\n` + failures.join('\n'))
  process.exit(1)
}
console.log(`Screenshots in ${out}; checks and axe clean.`)
