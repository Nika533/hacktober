import { describe, expect, it, vi } from 'vitest'
import {
  createPdfRouter,
  isDisplayedPdf,
  viewerUrl,
  type PdfRouter,
  type PdfRouterOptions,
  type ResponseDetails
} from '../src/sw/pdf'

const BASE = 'chrome-extension://ext/'
const PDF = 'https://example.com/papers/a.pdf'

interface Setup {
  router: PdfRouter
  redirect: ReturnType<typeof vi.fn>
  advance(ms: number): number
}

function setup(overrides: Partial<PdfRouterOptions> = {}): Setup {
  const redirect = vi.fn()
  let clock = 0
  const router = createPdfRouter({
    base: BASE,
    enabled: async () => true,
    fileAccess: async () => true,
    fileAsked: async () => false,
    redirect,
    now: () => clock,
    ...overrides
  })
  return { router, redirect, advance: (ms: number) => (clock += ms) }
}

const response = (headers: Array<[string, string]>, extra = {}): ResponseDetails => ({
  tabId: 3,
  url: PDF,
  type: 'main_frame',
  responseHeaders: headers.map(([name, value]) => ({ name, value })),
  ...extra
})

describe('PDF routing', () => {
  it('recognises PDFs the browser would display, not downloads', () => {
    expect(isDisplayedPdf(PDF, [{ name: 'Content-Type', value: 'application/pdf' }])).toBe(true)
    expect(
      isDisplayedPdf(PDF, [
        { name: 'content-type', value: 'application/pdf' },
        { name: 'Content-Disposition', value: 'attachment; filename=a.pdf' }
      ])
    ).toBe(false)
    expect(isDisplayedPdf(PDF, [{ name: 'content-type', value: 'application/octet-stream' }])).toBe(
      true
    )
    expect(isDisplayedPdf('https://x.test/a', [{ name: 'content-type', value: 'text/html' }])).toBe(
      false
    )
  })

  it('sends top-level PDF responses to the viewer', async () => {
    const { router, redirect } = setup()
    await router.onResponse(response([['content-type', 'application/pdf']]))
    expect(redirect).toHaveBeenCalledWith(3, viewerUrl(BASE, PDF))
    expect(viewerUrl(BASE, PDF)).toBe(`${BASE}viewer.html?file=${encodeURIComponent(PDF)}`)
  })

  it('ignores frames, background requests and a switched-off viewer', async () => {
    const pdf: Array<[string, string]> = [['content-type', 'application/pdf']]
    const { router, redirect } = setup()
    await router.onResponse(response(pdf, { type: 'sub_frame' }))
    await router.onResponse(response(pdf, { tabId: -1 }))
    const off = setup({ enabled: async () => false })
    await off.router.onResponse(response(pdf))
    expect(redirect).not.toHaveBeenCalled()
    expect(off.redirect).not.toHaveBeenCalled()
  })

  it('lets one URL through to the browser’s viewer, for 30 s', async () => {
    const pdf: Array<[string, string]> = [['content-type', 'application/pdf']]
    const { router, redirect, advance } = setup()
    router.allowNative(PDF)
    await router.onResponse(response(pdf))
    expect(redirect).not.toHaveBeenCalled()
    await router.onResponse(response(pdf))
    expect(redirect).toHaveBeenCalledOnce()
    router.allowNative(PDF)
    advance(31_000)
    await router.onResponse(response(pdf))
    expect(redirect).toHaveBeenCalledTimes(2)
  })

  it('opens local PDFs with file access, and asks for it only once', async () => {
    const file = 'file:///C:/papers/a.PDF'
    const nav = { tabId: 4, url: file, frameId: 0 }
    const allowed = setup()
    await allowed.router.onNavigation(nav)
    await allowed.router.onNavigation({ ...nav, url: 'file:///C:/notes.txt' })
    await allowed.router.onNavigation({ ...nav, frameId: 2 })
    expect(allowed.redirect).toHaveBeenCalledOnce()

    const first = setup({ fileAccess: async () => false })
    await first.router.onNavigation(nav)
    expect(first.redirect).toHaveBeenCalledOnce()
    const asked = setup({ fileAccess: async () => false, fileAsked: async () => true })
    await asked.router.onNavigation(nav)
    expect(asked.redirect).not.toHaveBeenCalled()
  })
})
