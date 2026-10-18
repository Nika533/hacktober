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

// A gallery section by its own title (Settings has h2 group headings of its own).
const gallerySection = (page, title) =>
  page.locator(`.gallery__section:has(> h2:text-is("${title}"))`)

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
      // Studio frame: sidebar + chat pane.
      const studio = gallerySection(page, 'Studio')
      await studio
        .locator('.gallery__studio')
        .screenshot({ path: resolve(out, `studio-${v.name}.png`) })

      // Settings: at rest, then a rejected key with Argon picked, then the clear confirm.
      const settings = page.locator('.gallery__settings')
      await settings.scrollIntoViewIfNeeded()
      await settings.screenshot({ path: resolve(out, `settings-${v.name}.png`) })
      await settings.getByRole('textbox', { name: 'Gemini API key' }).fill('bad-key')
      await settings.getByRole('button', { name: 'Check and save' }).click()
      await settings.getByText('Google rejected this key').waitFor()
      await settings.getByText('Argon', { exact: true }).click()
      await settings.getByText('Argon needs a paid-tier').waitFor()
      await settings.screenshot({ path: resolve(out, `settings-error-${v.name}.png`) })
      await axe(page, `${v.name} + settings error`)
      await settings.getByRole('button', { name: 'Clear all chats…' }).click()
      await page.getByRole('alertdialog').waitFor()
      await page.waitForTimeout(400)
      await page.screenshot({ path: resolve(out, `settings-clear-${v.name}.png`) })
      await axe(page, `${v.name} + settings confirm`)
      await page.keyboard.press('Escape')
      await page.getByRole('alertdialog').waitFor({ state: 'hidden' })

      // Onboarding: every step, saving a key on the way, then back to the start.
      const onb = page.locator('.gallery__onboarding')
      await onb.scrollIntoViewIfNeeded()
      const onbStep = async (n, title) => {
        await onb.locator(`[data-step="${n}"] h1`, { hasText: title }).waitFor()
        await page.waitForTimeout(450) // let the slide settle
        await onb.screenshot({ path: resolve(out, `onboarding-${n}-${v.name}.png`) })
      }
      await onbStep(0, 'Hi, I’m Hoot')
      await axe(page, `${v.name} + onboarding`)
      await onb.getByRole('button', { name: 'Get started' }).click()
      await onbStep(1, 'Connect Gemini')
      await onb.getByRole('textbox', { name: 'Gemini API key' }).fill('AIza-demo')
      await onb.getByRole('button', { name: 'Check and save' }).click()
      await onb.getByRole('button', { name: 'Continue' }).click()
      await onbStep(2, 'Your shortcuts')
      await axe(page, `${v.name} + onboarding shortcuts`)
      await onb.getByRole('button', { name: 'Continue' }).click()
      await onbStep(3, 'You’re all set')
      await onb.getByRole('button', { name: 'Start using Hoot' }).click()

      // Chat: the resting conversation, then a fresh question mid-stream.
      const chat = gallerySection(page, 'Chat')
      await chat.screenshot({ path: resolve(out, `chat-${v.name}.png`) })
      const box = chat.getByRole('textbox', { name: 'Message Hoot' })
      await box.fill('Why the dip in Q3?')
      await box.press('Enter')
      await page.waitForTimeout(700)
      await chat.screenshot({ path: resolve(out, `chat-streaming-${v.name}.png`) })
      await axe(page, `${v.name} + streaming`)
      // The fake stream may already have finished during the axe pass.
      const stop = chat.getByRole('button', { name: 'Stop answering' })
      if (await stop.isVisible()) await stop.click()

      // Shortcuts: at rest (one with a host error), then mid-recording.
      const shortcuts = gallerySection(page, 'Shortcuts')
      await shortcuts.screenshot({ path: resolve(out, `shortcuts-${v.name}.png`) })
      await shortcuts.locator('.hoot-hotkey__field').first().click()
      await page.keyboard.down('Control')
      await page.keyboard.down('Alt')
      await page.waitForTimeout(150)
      await shortcuts.screenshot({ path: resolve(out, `shortcuts-recording-${v.name}.png`) })
      await axe(page, `${v.name} + recording`)
      await page.keyboard.up('Alt')
      await page.keyboard.up('Control')
      await page.keyboard.press('Escape')

      // Overlays: keyboard tooltip, then the destructive confirm.
      // Tab from the previous button so focus is keyboard focus (:focus-visible).
      const section = gallerySection(page, 'Icon buttons')
      await section.getByRole('button', { name: 'New chat' }).focus()
      await page.keyboard.press('Tab')
      await page.locator('.hoot-tooltip').waitFor({ timeout: 3000 })
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
