import { Notification, desktopCapturer, nativeImage, screen } from 'electron'
import type { NativeImage } from 'electron'
import { getState, updateState } from './store/state'
import { bboxOfPoints, fitWithin, physicalCropRect } from '../shared/geometry'
import type {
  Attachment,
  BuddyMode,
  CaptureMode,
  OverlayCommit,
  OverlayInit,
  Rect
} from '../shared/types'
import type { Persistence } from './store/persistence'
import type { BuddyWindow } from './windows/buddy'
import type { StudioWindow } from './windows/studio'
import type { OverlayWindow } from './windows/overlay'

export const MAX_PENDING = 4
const MAX_LONG_EDGE = 1568
const THUMB_EDGE = 160
const SHOW_DELAY_MS = 120

export interface CaptureDeps {
  persistence: Persistence
  buddy(): BuddyWindow | null
  studio(): StudioWindow | null
  overlay(): OverlayWindow | null
}

interface ActiveCapture {
  image: NativeImage
  /** image px per DIP, from the actual capture size (not scaleFactor) */
  ratio: number
  displayW: number
  displayH: number
  fromStudio: boolean
  prevMode: BuddyMode
}

let deps: CaptureDeps | null = null
let active: ActiveCapture | null = null
let activeInit: OverlayInit | null = null

export function initCapture(d: CaptureDeps): void {
  deps = d
}

export function isCapturing(): boolean {
  return active !== null
}

export function overlayInit(): OverlayInit | null {
  return activeInit
}

/** Downsampled black check — a protected/unreadable screen comes back black. */
function isAllBlack(img: NativeImage): boolean {
  const small = img.resize({ width: 64 })
  const bmp = small.toBitmap() // BGRA
  for (let i = 0; i < bmp.length; i += 4) {
    if (bmp[i] > 10 || bmp[i + 1] > 10 || bmp[i + 2] > 10) return false
  }
  return true
}

export async function startCapture(mode: CaptureMode = 'lasso'): Promise<void> {
  const d = deps
  if (!d || active) return
  const s = getState()
  if (s.pendingAttachments.length >= MAX_PENDING) {
    new Notification({ title: 'Hoot', body: 'Up to 4 captures per message' }).show()
    return
  }

  const studio = d.studio()
  const fromStudio = !!studio?.isVisible()
  const prevMode = s.buddyMode
  if (fromStudio) studio!.hide()
  else d.buddy()?.suspend()

  await new Promise((r) => setTimeout(r, SHOW_DELAY_MS))

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)

  let image: NativeImage | null
  const fakePath = process.env.HOOT_FAKE_CAPTURE
  if (fakePath) {
    image = nativeImage.createFromPath(fakePath)
    console.log('[capture] fake fixture:', fakePath, 'size:', JSON.stringify(image.getSize()))
  } else {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * display.scaleFactor),
          height: Math.round(display.size.height * display.scaleFactor)
        }
      })
      const src = sources.find((x) => x.display_id === String(display.id)) ?? sources[0]
      image = src?.thumbnail ?? null
      console.log(
        '[capture] sources:',
        sources.length,
        '| display.id:',
        display.id,
        '| chosen display_id:',
        src?.display_id ?? 'none',
        '| image size:',
        image ? JSON.stringify(image.getSize()) : 'null',
        '| allBlack:',
        image ? isAllBlack(image) : 'n/a'
      )
    } catch (err) {
      console.error('[capture] desktopCapturer failed:', err)
      image = null
    }
  }

  const restore = (): void => {
    if (fromStudio) studio!.show()
    else d.buddy()?.resume(prevMode)
  }

  if (!image || image.isEmpty() || isAllBlack(image)) {
    new Notification({
      title: 'Hoot',
      body: "Couldn't capture this screen (it may be protected)"
    }).show()
    restore()
    return
  }

  const imgSize = image.getSize()
  active = {
    image,
    ratio: imgSize.width / display.bounds.width,
    displayW: display.bounds.width,
    displayH: display.bounds.height,
    fromStudio,
    prevMode
  }
  activeInit = {
    imageDataUrl: `data:image/jpeg;base64,${image.toJPEG(90).toString('base64')}`,
    displayWidth: display.bounds.width,
    displayHeight: display.bounds.height,
    mode,
    accentColor: getState().accentColor,
    pendingCount: getState().pendingAttachments.length
  }
  d.overlay()?.showOn(display)
}

/** Dismiss the overlay without capturing; restores whatever was showing. */
export function cancelCapture(): void {
  const d = deps
  const cap = active
  if (!d || !cap) return
  active = null
  activeInit = null
  d.overlay()?.hide()
  if (cap.fromStudio) d.studio()?.show()
  else d.buddy()?.resume(cap.prevMode)
}

export async function commitCapture(payload: OverlayCommit): Promise<void> {
  const d = deps
  const cap = active
  if (!d || !cap) return

  const done = (restoreToCard: boolean): void => {
    active = null
    activeInit = null
    d.overlay()?.hide()
    if (cap.fromStudio) d.studio()?.show()
    else if (restoreToCard) d.buddy()?.resume('card')
    else d.buddy()?.resume(cap.prevMode)
  }

  const local: Rect = { x: 0, y: 0, width: cap.displayW, height: cap.displayH }
  let dip: Rect | null
  if (payload.kind === 'full') dip = local
  else if (payload.kind === 'rect') dip = payload.rect
  else dip = bboxOfPoints(payload.points, 8, local)

  const imgSize = cap.image.getSize()
  const phys = dip ? physicalCropRect(dip, cap.ratio, imgSize.width, imgSize.height) : null
  if (!phys || phys.width < 2 || phys.height < 2) {
    done(false)
    return
  }

  const cropped = cap.image.crop(phys)
  await addImageAttachment(cropped, 'capture')
  done(true)
}

/**
 * Shared attachment pipeline (captures + clipboard images):
 * fit to 1568 long edge → PNG in attachments/ → 160px thumb → pending.
 */
export async function addImageAttachment(
  image: NativeImage,
  kind: Attachment['kind']
): Promise<Attachment | null> {
  const d = deps
  if (!d) return null
  const size = image.getSize()
  const fit = fitWithin(size.width, size.height, MAX_LONG_EDGE)
  const resized =
    fit.width === size.width && fit.height === size.height
      ? image
      : image.resize({ width: fit.width, height: fit.height, quality: 'best' })

  const id = crypto.randomUUID()
  await d.persistence.saveAttachment(id, resized.toPNG())

  const tf = fitWithin(fit.width, fit.height, THUMB_EDGE)
  const thumb = resized.resize({ width: Math.max(1, tf.width), height: Math.max(1, tf.height) })
  const attachment: Attachment = {
    id,
    kind,
    path: d.persistence.attachmentPath(id),
    thumbDataUrl: `data:image/png;base64,${thumb.toPNG().toString('base64')}`,
    width: fit.width,
    height: fit.height,
    createdAt: Date.now()
  }
  updateState((s) => {
    s.pendingAttachments.push(attachment)
  })
  return attachment
}
