/**
 * Native messaging framing, also used on the hoot-bridge ⇄ app pipe so the
 * bridge can relay frames byte for byte: a 4-byte little-endian length, then
 * that many bytes of UTF-8 JSON.
 */

/** Chrome caps host → extension messages at 1 MB; Lens messages are tiny. */
export const MAX_FRAME_BYTES = 1024 * 1024

export class FrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function encodeFrame(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message))
  if (body.length > MAX_FRAME_BYTES) {
    throw new FrameError(`frame of ${body.length} bytes exceeds ${MAX_FRAME_BYTES}`)
  }
  const frame = new Uint8Array(4 + body.length)
  new DataView(frame.buffer).setUint32(0, body.length, true)
  frame.set(body, 4)
  return frame
}

/** Accepts arbitrary chunks and yields every complete message. */
export class FrameDecoder {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.buf.length + chunk.length)
    joined.set(this.buf, 0)
    joined.set(chunk, this.buf.length)
    this.buf = joined

    const out: unknown[] = []
    for (;;) {
      if (this.buf.length < 4) break
      const len = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0, true)
      if (len > MAX_FRAME_BYTES) {
        this.buf = new Uint8Array(0)
        throw new FrameError(`incoming frame of ${len} bytes exceeds ${MAX_FRAME_BYTES}`)
      }
      if (this.buf.length < 4 + len) break
      const body = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.slice(4 + len)
      let text: string
      try {
        text = decoder.decode(body)
      } catch {
        throw new FrameError('frame is not valid UTF-8')
      }
      try {
        out.push(JSON.parse(text))
      } catch {
        throw new FrameError('frame is not valid JSON')
      }
    }
    return out
  }

  /** Bytes received but not yet forming a whole frame. */
  get pending(): number {
    return this.buf.length
  }
}
