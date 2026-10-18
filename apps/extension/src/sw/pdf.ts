export const PDF_ENABLED_KEY = 'lens.pdf.enabled'
export const FILE_ASKED_KEY = 'lens.pdf.fileAsked'
const BYPASS_MS = 30_000

export interface HeaderLike {
  name: string
  value?: string
}

export const viewerUrl = (base: string, file: string): string =>
  `${base}viewer.html?file=${encodeURIComponent(file)}`

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/** A top-level response the browser would show as a PDF (not download). */
export function isDisplayedPdf(url: string, headers: readonly HeaderLike[] = []): boolean {
  const header = (name: string): string =>
    headers.find((h) => h.name.toLowerCase() === name)?.value?.toLowerCase() ?? ''
  if (header('content-disposition').trim().startsWith('attachment')) return false
  const type = header('content-type')
  if (type.startsWith('application/pdf')) return true
  return type.startsWith('application/octet-stream') && /\.pdf$/i.test(pathOf(url))
}

export interface PdfRouterOptions {
  /** chrome-extension://<id>/ */
  base: string
  enabled(): Promise<boolean>
  fileAccess(): Promise<boolean>
  fileAsked(): Promise<boolean>
  redirect(tabId: number, url: string): void
  now?: () => number
}

/**
 * Sends PDFs to the extension's viewer (D2-31): http(s) responses served as
 * PDFs and file:// PDFs. "Open in the browser's viewer" lets one URL through.
 * Local files go to the viewer only with file access, or once to ask for it.
 */
export interface ResponseDetails {
  tabId: number
  url: string
  type: string
  responseHeaders?: HeaderLike[]
}

export interface NavigationDetails {
  tabId: number
  url: string
  frameId: number
}

export interface PdfRouter {
  allowNative(url: string): void
  onResponse(details: ResponseDetails): Promise<void>
  onNavigation(details: NavigationDetails): Promise<void>
}

export function createPdfRouter(options: PdfRouterOptions): PdfRouter {
  const now = options.now ?? (() => Date.now())
  const bypass = new Map<string, number>()

  const letThrough = (url: string): boolean => {
    const until = bypass.get(url)
    if (until === undefined) return false
    bypass.delete(url)
    return until >= now()
  }

  const send = async (tabId: number, url: string): Promise<void> => {
    if (letThrough(url) || !(await options.enabled())) return
    options.redirect(tabId, viewerUrl(options.base, url))
  }

  return {
    allowNative(url: string): void {
      bypass.set(url, now() + BYPASS_MS)
    },
    async onResponse(details) {
      if (details.tabId < 0 || details.type !== 'main_frame') return
      if (!isDisplayedPdf(details.url, details.responseHeaders)) return
      await send(details.tabId, details.url)
    },
    async onNavigation(details) {
      if (details.frameId !== 0 || !details.url.startsWith('file:')) return
      if (!/\.pdf$/i.test(pathOf(details.url))) return
      if (!(await options.fileAccess()) && (await options.fileAsked())) return
      await send(details.tabId, details.url)
    }
  }
}
