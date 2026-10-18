import { desktopCapturer, nativeImage, screen } from 'electron'
import type { Rect } from '@hoot/core'
import type { Logger } from '../log'
import { fromNativeImage, type CaptureImage } from './image'

export interface Grab {
  image: CaptureImage
  /** The display under the cursor, in screen DIP. */
  display: { id: number; bounds: Rect }
}

export interface ScreenGrabber {
  /** The whole display under the cursor, or null when it couldn't be grabbed. */
  grab(): Promise<Grab | null>
  /** The first getSources call takes about 3 s cold (D1-00), so make it once at idle. */
  prewarm(): void
}

/**
 * desktopCapturer for the display under the cursor. `HOOT_FAKE_CAPTURE=<png>`
 * returns that file instead (e2e and demos without a real screen).
 */
export function createScreenGrabber(
  log: Logger,
  fakePath = process.env['HOOT_FAKE_CAPTURE']
): ScreenGrabber {
  let warmed = false
  return {
    async grab() {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const target = { id: display.id, bounds: display.bounds }
      // Ask for the physical size: a larger thumbnail is upscaled, a smaller one loses detail.
      // The crop ratio comes from the image Electron actually returns.
      const size = {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
      if (fakePath) {
        // Shaped like a real grab of this display.
        const image = nativeImage.createFromPath(fakePath).resize(size)
        return { image: fromNativeImage(image), display: target }
      }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
      const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
      if (!source) return null
      if (source.display_id !== String(display.id)) {
        log.warn(
          `capture: no source for display ${display.id}, using ${source.display_id || source.id}`
        )
      }
      return { image: fromNativeImage(source.thumbnail), display: target }
    },
    prewarm() {
      if (warmed || fakePath) return
      warmed = true
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } })
        .catch((e: unknown) => log.warn(`capture: prewarm failed: ${String(e)}`))
    }
  }
}
