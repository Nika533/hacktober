import AxeBuilder from '@axe-core/playwright'
import { test, type Page } from '@playwright/test'
import { expect, launch, open, shutdown, ui, type Harness } from './harness'

let harness: Harness

test.beforeEach(async () => {
  harness = await launch()
})

test.afterEach(async () => {
  await shutdown(harness)
})

async function axe(page: Page, state: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .include('hoot-lens-ui')
    .include('hoot-lens-mark')
    .analyze()
  const found = violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} ${n.target.join(' > ')} ${n.failureSummary}`)
  )
  expect(found, state).toEqual([])
}

const SCHEMES = [
  { colorScheme: 'light', contrast: 'no-preference' },
  { colorScheme: 'dark', contrast: 'no-preference' },
  { colorScheme: 'light', contrast: 'more' }
] as const

for (const media of SCHEMES) {
  test(`the Lens UI passes axe (${media.colorScheme}, contrast ${media.contrast})`, async () => {
    const { context, fixtures } = harness
    const page = await context.newPage()
    await page.emulateMedia({ ...media, reducedMotion: 'reduce' })
    await open(page, `${fixtures.url}/article.html`)

    await page.locator('#p-hetero em').dblclick()
    await expect(ui(page, '.chip')).toBeVisible()
    await axe(page, 'Ask-first chip')

    await ui(page, '.chip').click()
    const mark = page.locator('#p-hetero hoot-lens-mark mark')
    await expect(mark).toHaveText('heteroscedasticity (a fake definition)')
    await expect(ui(page, '.pill')).toBeVisible()
    await mark.focus()
    await page.keyboard.press('Enter')
    await expect(ui(page, '[role="dialog"]')).toBeVisible()
    await axe(page, 'mark, popover and page pill')
    await page.screenshot({
      path: test.info().outputPath(`lens-ui-${media.colorScheme}-contrast-${media.contrast}.png`)
    })

    await page.keyboard.press('Escape')
    await page.keyboard.press('Alt+H')
    await expect(ui(page, '.pill .status')).toHaveText('Lens is paused on this site')
    await expect(page.locator('hoot-lens-mark')).toHaveCount(0)
    await axe(page, 'paused pill')
  })
}
