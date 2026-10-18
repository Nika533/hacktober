import { describe, expect, it } from 'vitest'
import type { ReaderDocument } from '@hoot/core'
import { createLogger } from '../src/main/log'
import { kindFromName, createReaderService } from '../src/main/services/reader'
import type { ReaderWindow } from '../src/main/windows/reader'

const log = createLogger('test')
const DOC_CHANNEL = 'reader:document'

type FakeReaderWindow = ReaderWindow & {
  sent: [string, unknown][]
  opens(): number
  fireReady(): void
}

/** Fake ReaderWindow: sends are recorded only once fireReady() ran. */
const fakeWindow = (): FakeReaderWindow => {
  const sent: [string, unknown][] = []
  const readyCbs: (() => void)[] = []
  let opens = 0
  return {
    sent,
    opens: () => opens,
    fireReady: () => {
      for (const cb of readyCbs.splice(0)) cb()
    },
    open: () => {
      opens += 1
    },
    isOpen: () => true,
    send: (ch: string, p: unknown) => {
      sent.push([ch, p])
    },
    onReady: (cb: () => void) => {
      readyCbs.push(cb)
    },
    browserWindow: () => null
  } as FakeReaderWindow
}

const makeService = (
  over: {
    dialog?: Pick<Electron.Dialog, 'showOpenDialog'>
    files?: Record<string, Uint8Array>
    sizes?: Record<string, number>
    window?: FakeReaderWindow
  } = {}
): { service: ReturnType<typeof createReaderService>; window: FakeReaderWindow } => {
  const window = over.window ?? fakeWindow()
  const service = createReaderService({
    window,
    dialog:
      over.dialog ??
      ({
        showOpenDialog: async () => ({ canceled: true, filePaths: [] })
      } as unknown as Pick<Electron.Dialog, 'showOpenDialog'>),
    readFile: async (p) => {
      const b = over.files?.[p]
      if (!b) throw new Error(`ENOENT ${p}`)
      return b
    },
    stat: async (p) => {
      if (!(p in (over.files ?? {})) && !(p in (over.sizes ?? {}))) throw new Error(`ENOENT ${p}`)
      return { size: over.sizes?.[p] ?? over.files![p]!.byteLength }
    },
    log
  })
  return { service, window }
}

describe('kindFromName', () => {
  it('maps pdf/html extensions, case-insensitively', () => {
    expect(kindFromName('paper.pdf')).toBe('pdf')
    expect(kindFromName('Paper.PDF')).toBe('pdf')
    expect(kindFromName('page.html')).toBe('html')
    expect(kindFromName('page.htm')).toBe('html')
    expect(kindFromName('x.TXT')).toBe(null)
    expect(kindFromName('noext')).toBe(null)
  })
})

describe('reader service', () => {
  it('pickFile returns null when the dialog is cancelled', async () => {
    const { service } = makeService()
    expect(await service.pickFile()).toBe(null)
    expect(service.current()).toBe(null)
  })

  it('pickFile opens the chosen path and returns the document', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const dialog = {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['C:/docs/paper.pdf'] })
    } as unknown as Pick<Electron.Dialog, 'showOpenDialog'>
    const { service, window } = makeService({ dialog, files: { 'C:/docs/paper.pdf': bytes } })
    const doc = await service.pickFile()
    expect(doc).toMatchObject({ name: 'paper.pdf', kind: 'pdf' })
    expect(doc!.bytes).toEqual(bytes)
    expect(service.current()).toBe(doc)
    expect(window.opens()).toBe(1)
  })

  it('defers reader:document until the page is ready, then sends once', async () => {
    const { service, window } = makeService()
    const doc: ReaderDocument = { name: 'a.pdf', kind: 'pdf', bytes: new Uint8Array([9]) }
    service.openDocument(doc)
    expect(window.sent).toHaveLength(0)
    window.fireReady()
    expect(window.sent).toEqual([[DOC_CHANNEL, doc]])
    // a second doc goes straight through — page is loaded now
    const doc2: ReaderDocument = { name: 'b.html', kind: 'html', bytes: new Uint8Array([7]) }
    service.openDocument(doc2)
    expect(window.sent).toEqual([
      [DOC_CHANNEL, doc],
      [DOC_CHANNEL, doc2]
    ])
    expect(service.current()).toBe(doc2)
  })

  it('openPath rejects unknown extensions without reading', async () => {
    const { service } = makeService({ files: { 'x.txt': new Uint8Array([1]) } })
    expect(await service.openPath('x.txt')).toBe(null)
    expect(service.current()).toBe(null)
  })

  it('openPath refuses files over 50 MB without reading', async () => {
    const { service } = makeService({ sizes: { 'big.pdf': 51 * 1024 * 1024 } })
    expect(await service.openPath('big.pdf')).toBe(null)
  })

  it('openPath returns null when the file cannot be read', async () => {
    const { service } = makeService()
    expect(await service.openPath('missing.pdf')).toBe(null)
  })
})
