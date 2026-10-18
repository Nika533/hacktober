import type { NativeImage } from 'electron'
import type { Rect } from '@hoot/core'

/** The image operations capture needs; NativeImage in the app, a fake in tests. */
export interface CaptureImage {
  readonly width: number
  readonly height: number
  /** True for an empty or all-black grab, which is what a protected screen returns. */
  isBlank(): boolean
  crop(rect: Rect): CaptureImage
  resize(width: number, height: number): CaptureImage
  toJpegDataUrl(quality: number): string
  toPng(): Uint8Array
  toPngDataUrl(): string
}

export function fromNativeImage(image: NativeImage): CaptureImage {
  const { width, height } = image.getSize()
  return {
    width,
    height,
    isBlank() {
      if (image.isEmpty() || width === 0 || height === 0) return true
      const bgra = image.resize({ width: 64 }).toBitmap()
      for (let i = 0; i < bgra.length; i += 4) {
        if (bgra[i]! > 10 || bgra[i + 1]! > 10 || bgra[i + 2]! > 10) return false
      }
      return true
    },
    crop: (rect) => fromNativeImage(image.crop(rect)),
    resize: (w, h) => fromNativeImage(image.resize({ width: w, height: h, quality: 'best' })),
    toJpegDataUrl: (quality) =>
      `data:image/jpeg;base64,${image.toJPEG(quality).toString('base64')}`,
    toPng: () => image.toPNG(),
    toPngDataUrl: () => `data:image/png;base64,${image.toPNG().toString('base64')}`
  }
}
