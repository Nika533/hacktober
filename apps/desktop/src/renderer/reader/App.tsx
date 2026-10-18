import '@hoot/ui/styles.css'
import '@hoot/pdf-view/styles.css'
import './reader.css'
import { DEFAULT_SUBSCRIPTIONS, type HootApi, type ReaderDocument } from '@hoot/core'
import {
  applyAccent,
  applyTheme,
  Button,
  createIpcLensBackend,
  createLensSettingsFeed,
  HootUIProvider,
  Owl,
  useHootState
} from '@hoot/ui'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PdfReader } from './PdfReader'

const SLICES = DEFAULT_SUBSCRIPTIONS.reader

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <Reader hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

const isPdf = (f: File): boolean => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

async function fromFile(f: File): Promise<ReaderDocument> {
  return { name: f.name, kind: 'pdf', bytes: new Uint8Array(await f.arrayBuffer()) }
}

/**
 * Hoot Reader: a local PDF in pdf-view with Lens on top, the same marks,
 * popover and shortcuts as the browser extension. Lens talks to the app
 * through `window.hoot` instead of the bridge.
 */
function Reader({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element {
  const { state } = useHootState(hoot, SLICES)
  const [doc, setDoc] = useState<ReaderDocument | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const system = state?.system
  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  // Lens settings come from this window's settings slice.
  const [feed] = useState(createLensSettingsFeed)
  const lens = state?.settings?.settings.lens
  useEffect(() => {
    if (lens) feed.push(lens)
  }, [lens, feed])
  const backend = useMemo(() => (hoot ? createIpcLensBackend(hoot, feed) : null), [hoot, feed])

  // A document main hands over ("Open in Hoot Reader", a dropped file on the owl).
  useEffect(() => {
    if (!hoot) return
    hoot.reader.current().then(
      (d) => d && setDoc(d),
      () => undefined
    )
    return hoot.reader.onDocument(setDoc)
  }, [hoot])

  useEffect(() => {
    document.title = doc ? `${doc.name} – Hoot Reader` : 'Hoot Reader'
  }, [doc])

  const open = useCallback((): void => {
    // Main's file dialog when it offers one; the window's own picker otherwise.
    if (!hoot) {
      input.current?.click()
      return
    }
    hoot.reader.pickFile().then(
      (d) => d && setDoc(d),
      () => input.current?.click()
    )
  }, [hoot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const take = (files: FileList | null): void => {
    const f = files ? [...files].find(isPdf) : undefined
    if (f) void fromFile(f).then(setDoc)
  }

  return (
    <div
      className="hoot-reader"
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        take(e.dataTransfer.files)
      }}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hoot-visually-hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          take(e.currentTarget.files)
          e.currentTarget.value = ''
        }}
      />
      {doc && backend ? (
        <PdfReader
          key={`${doc.name}:${doc.bytes.byteLength}`}
          doc={doc}
          backend={backend}
          lensOn={lens?.enabled === true}
          onOpen={open}
          onOpenReading={() => void hoot?.windows.openStudio('reading').catch(() => undefined)}
        />
      ) : (
        <main className="hoot-reader__empty">
          <Owl mood="idle" size={72} />
          <h1 className="hoot-reader__empty-title">Read a PDF with Hoot Lens</h1>
          <p className="hoot-reader__empty-hint">
            Select a word or sentence you don’t understand, and Hoot explains it in place.
          </p>
          <Button variant="primary" icon={<FolderOpen />} onClick={open}>
            Open a PDF…
          </Button>
          <p className="hoot-reader__empty-hint">or drop one on this window</p>
        </main>
      )}
    </div>
  )
}
