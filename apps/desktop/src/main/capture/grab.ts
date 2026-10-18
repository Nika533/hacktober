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
  /**
   * The first getSources call is slow (D1-00: ~3 s) and blocks the whole main
   * process while it runs (measured: ~1.7 s on a fast machine), so it's made
   * once the app has settled, never during startup. A capture warms it anyway.
   */
  prewarm(): void
}

export interface ScreenGrabberOptions {
  /** `HOOT_FAKE_CAPTURE=<png>`: return that file instead (e2e and demos without a real screen). */
  fakePath?: string
  /** Off in test runs (`HOOT_TEST=1`): a stalled main process makes other specs time out. */
  warm?: boolean
  /** How long after `prewarm()` the warm-up grab runs. */
  warmDelayMs?: number
}

export const PREWARM_DELAY_MS = 10_000

/** desktopCapturer for the display under the cursor. */
export function createScreenGrabber(
  log: Logger,
  options: ScreenGrabberOptions = {
    fakePath: process.env['HOOT_FAKE_CAPTURE'],
    warm: process.env['HOOT_TEST'] !== '1'
  }
): ScreenGrabber {
  const { fakePath, warm = true, warmDelayMs = PREWARM_DELAY_MS } = options
  let warmed = false
  let timer: ReturnType<typeof setTimeout> | null = null
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
      warmed = true
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
      if (warmed || timer || fakePath || !warm) return
      timer = setTimeout(() => {
        timer = null
        if (warmed) return
        warmed = true
        const started = Date.now()
        desktopCapturer
          .getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } })
          .then(() => log.info(`capture: grabber warmed in ${Date.now() - started} ms`))
          .catch((e: unknown) => log.warn(`capture: prewarm failed: ${String(e)}`))
      }, warmDelayMs)
      timer.unref?.()
    }
  }
}
