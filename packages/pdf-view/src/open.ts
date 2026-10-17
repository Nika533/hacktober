import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'

export type PdfSource = { data: Uint8Array | ArrayBuffer } | { url: string }

export interface OpenPdfOptions {
  /**
   * URL of pdf.worker(.min).mjs. Hosts resolve it for their bundler: Vite
   * `import src from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`, the
   * extension `chrome.runtime.getURL(...)`.
   */
  workerSrc?: string
  /** Folder URL (trailing slash) of pdfjs-dist/standard_fonts/, for non-embedded fonts. */
  standardFontDataUrl?: string
  /** Folder URL (trailing slash) of pdfjs-dist/cmaps/, for CJK PDFs. */
  cMapUrl?: string
  password?: string
}

/**
 * Opens a PDF. XFA forms are off: the reader shows documents, it doesn't
 * run them. (PDF.js 6 no longer uses eval, so strict CSPs are fine.) Call
 * `doc.loadingTask.destroy()` when done.
 */
export function openPdf(
  source: PdfSource,
  options: OpenPdfOptions = {}
): Promise<PDFDocumentProxy> {
  if (options.workerSrc) GlobalWorkerOptions.workerSrc = options.workerSrc
  const input =
    'url' in source
      ? { url: source.url }
      : { data: source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data) }
  return getDocument({
    ...input,
    enableXfa: false,
    standardFontDataUrl: options.standardFontDataUrl,
    cMapUrl: options.cMapUrl,
    cMapPacked: true,
    password: options.password
  }).promise
}
