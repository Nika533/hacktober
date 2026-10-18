import { clipboard, nativeImage } from 'electron'
import {
  decideHint,
  imageFingerprint,
  textFingerprint,
  type ClipboardFingerprint,
  type ClipboardProbe
} from '@hoot/core'
import type { Logger } from './log'
import type { Store } from './store/store'

export interface ClipboardWatcherDeps {
  store: Store
  log: Logger
  /** Reads the clipboard once (Electron impl below; faked in tests). */
  probe?: () => Promise<ClipboardProbe | null>
  /** Current clipboard text, snapshotted when the hint is armed. */
  readText?: () => Promise<string>
}

export interface ClipboardWatcher {
  /** Snapshot the boot fingerprint: pre-existing content is never hinted. */
  init(): Promise<void>
  /** Run before the buddy leaves `hidden`: maybe show the clipboard chip. */
  onSummon(): Promise<void>
  /** Mark the hint armed and snapshot the text for the next send. */
  arm(): Promise<void>
  /** The armed text, once; also clears the hint. */
  take(): string | null
  dismiss(): void
}

/** Electron 44 clipboard is W3C-style: `read()` → `ClipboardItem.getType(mime)`. */
async function readImage(): Promise<Electron.NativeImage | null> {
  try {
    if (!(await clipboard.has('image/png'))) return null
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue
      const blob = await item.getType('image/png')
      const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      if (!img.isEmpty()) return img
    }
    return null
  } catch {
    return null
  }
}

/** One read → fingerprint + the hint it would show (image beats text). */
export async function probeClipboard(): Promise<ClipboardProbe | null> {
  try {
    const img = await readImage()
    if (img) {
      const { width, height } = img.getSize()
      const small = img.resize({ width: 16, height: 16 })
      const fp = imageFingerprint(width, height, new Uint8Array(small.toBitmap()))
      if (fp) return { fp, hint: { kind: 'image' } }
    }
    const text = await clipboard.readText()
    const fp = textFingerprint(text)
    return fp ? { fp, hint: { kind: 'text', chars: text.length } } : null
  } catch {
    return null
  }
}

/**
 * Clipboard-aware chip (D1-21): on every summon the clipboard is probed and
 * compared to the last fingerprint — only changed content can suggest the
 * "Want me to look at what you copied?" chip.
 */
export function createClipboardWatcher(deps: ClipboardWatcherDeps): ClipboardWatcher {
  const { store, log } = deps
  const probe = deps.probe ?? probeClipboard
  const readText = deps.readText ?? (() => clipboard.readText())

  let lastFp: ClipboardFingerprint | null = null
  let selection: string | null = null

  const clearHint = (): void => {
    if (store.get('chat').clipboardHint !== null) store.update('chat', { clipboardHint: null })
  }

  return {
    async init() {
      lastFp = (await probe())?.fp ?? null
    },

    async onSummon() {
      const p = await probe()
      const show = decideHint(lastFp, p, store.get('settings').settings.clipboardHint)
      lastFp = p?.fp ?? null
      selection = null
      store.update('chat', { clipboardHint: show && p ? p.hint : null })
    },

    async arm() {
      const hint = store.get('chat').clipboardHint
      if (!hint) return
      if (hint.kind === 'image') {
        // Arming an image means capturing it — that pipeline lands with d2.
        log.info('image clipboard arming lands with capture; marking selected only')
      } else {
        try {
          selection = await readText()
        } catch (e) {
          log.warn(`clipboard read for arm failed: ${String(e)}`)
          selection = null
        }
      }
      store.update('chat', { clipboardHint: { ...hint, selected: true } })
    },

    take() {
      const text = selection
      selection = null
      clearHint()
      return text
    },

    dismiss() {
      selection = null
      clearHint()
    }
  }
}
