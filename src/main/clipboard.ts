import { clipboard, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { imageFingerprint, textFingerprint, type ClipboardProbe } from '../shared/clipboard'

export function writeText(text: string): Promise<void> {
  return clipboard.writeText(text)
}

export function readText(): Promise<string> {
  return clipboard.readText()
}

/** Electron 44 clipboard is W3C-style: read() → ClipboardItem.getType(mime). */
export async function readImage(): Promise<NativeImage | null> {
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

/**
 * Read the clipboard once and return its fingerprint + the hint it would show.
 * Image takes priority over text (copied files often set both).
 */
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
