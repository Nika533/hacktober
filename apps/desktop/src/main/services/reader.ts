import { basename } from 'node:path'
import { HOOT_API_ROUTES, type ReaderDocument } from '@hoot/core'
import type { Logger } from '../log'
import type { ReaderWindow } from '../windows/reader'

/** Reader documents are read fully into memory — cap them. */
const MAX_BYTES = 50 * 1024 * 1024

export function kindFromName(name: string): ReaderDocument['kind'] | null {
  const i = name.lastIndexOf('.')
  if (i < 0) return null
  const ext = name.slice(i).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.html' || ext === '.htm') return 'html'
  return null
}

export interface ReaderService {
  /** Show the Reader window (the current document stays as it is). */
  open(): void
  pickFile(): Promise<ReaderDocument | null>
  current(): ReaderDocument | null
  openPath(path: string): Promise<ReaderDocument | null>
  openDocument(doc: ReaderDocument): void
}

export function createReaderService(deps: {
  window: ReaderWindow
  dialog: Pick<Electron.Dialog, 'showOpenDialog'>
  readFile: (path: string) => Promise<Uint8Array>
  stat: (path: string) => Promise<{ size: number }>
  log: Logger
}): ReaderService {
  const { window, dialog, log } = deps
  let current: ReaderDocument | null = null
  let pageReady = false
  let pending: ReaderDocument | null = null

  window.onReady(() => {
    pageReady = true
    if (pending !== null) {
      window.send(HOOT_API_ROUTES.reader.onDocument.channel, pending)
      pending = null
    }
  })

  const service: ReaderService = {
    open: () => window.open(),

    async pickFile() {
      const parent = window.browserWindow()
      const opts: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: [{ name: 'Documents', extensions: ['pdf', 'html', 'htm'] }]
      }
      const r = parent
        ? await dialog.showOpenDialog(parent, opts)
        : await dialog.showOpenDialog(opts)
      if (r.canceled || r.filePaths.length === 0) return null
      return service.openPath(r.filePaths[0]!)
    },

    current: () => current,

    async openPath(path) {
      const kind = kindFromName(basename(path))
      if (kind === null) {
        log.warn(`reader: unsupported file type: ${path}`)
        return null
      }
      try {
        const info = await deps.stat(path)
        if (info.size > MAX_BYTES) {
          log.warn(`reader: file too large (${info.size} bytes): ${path}`)
          return null
        }
        const bytes = await deps.readFile(path)
        const doc: ReaderDocument = { name: basename(path), kind, bytes }
        service.openDocument(doc)
        return doc
      } catch (e) {
        log.warn(`reader: failed to open ${path}: ${String(e)}`)
        return null
      }
    },

    openDocument(doc) {
      current = doc
      window.open()
      // The renderer also pulls reader.current() on mount; this push is the
      // fast path. Queue until the page is loaded when it isn't yet.
      if (pageReady) window.send(HOOT_API_ROUTES.reader.onDocument.channel, doc)
      else pending = doc
    }
  }

  return service
}
