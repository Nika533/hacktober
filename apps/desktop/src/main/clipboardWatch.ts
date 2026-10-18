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
  /**
   * Arming an image chip attaches the copied image to the next message (a
   * pending `clipboard-image` attachment). Resolves false when nothing was
   * attached (no image anymore, or the composer is full).
   */
  attachImage?: () => Promise<boolean>
}

export interface ClipboardWatcher {
  /** Snapshot the boot fingerprint: pre-existing content is never hinted. */
  init(): Promise<void>
  /** Run before the buddy leaves `hidden`: maybe show the clipboard chip. */
  onSummon(): Promise<void>
  /**
   * Toggle the chip: arming text snapshots it for the next send, arming an
   * image attaches it; arming an armed chip disarms it.
   */
  arm(): Promise<void>
  /** The armed text, once; also clears the hint. */
  take(): string | null
  dismiss(): void
}

/** Electron 44 clipboard is W3C-style: `read()` → `ClipboardItem.getType(mime)`. */
export async function readClipboardImage(): Promise<Electron.NativeImage | null> {
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
    const img = await readClipboardImage()
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
      // The chip is a toggle (ClipboardChip): a second press takes it back.
      if (hint.selected === true) {
        selection = null
        store.update('chat', { clipboardHint: { ...hint, selected: false } })
        return
      }
      if (hint.kind === 'image') {
        // The image becomes a pending attachment with its own removable chip,
        // so the suggestion is done; nothing is marked armed that won't send.
        let attached = false
        try {
          attached = (await deps.attachImage?.()) ?? false
        } catch (e) {
          log.warn(`clipboard image attach failed: ${String(e)}`)
        }
        if (attached) clearHint()
        else log.warn('clipboard image could not be attached')
        return
      }
      try {
        selection = await readText()
      } catch (e) {
        log.warn(`clipboard read for arm failed: ${String(e)}`)
        selection = null
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
