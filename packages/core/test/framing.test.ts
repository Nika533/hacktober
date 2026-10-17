import { describe, expect, it } from 'vitest'
import { FrameDecoder, FrameError, MAX_FRAME_BYTES, encodeFrame } from '../src/protocol/framing'

describe('framing', () => {
  it('writes a little-endian length prefix followed by UTF-8 JSON', () => {
    const frame = encodeFrame({ a: 'é' })
    const body = Buffer.from('{"a":"é"}', 'utf8')
    expect(Buffer.from(frame.subarray(0, 4)).readUInt32LE(0)).toBe(body.length)
    expect(Buffer.from(frame.subarray(4)).equals(body)).toBe(true)
  })

  it('round-trips several frames delivered in one chunk', () => {
    const chunk = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame('x')])
    expect(new FrameDecoder().push(chunk)).toEqual([{ n: 1 }, { n: 2 }, 'x'])
  })

  it('reassembles a frame split at every byte boundary', () => {
    const frame = encodeFrame({ type: 'hello', text: 'ünïcødé 🦉' })
    const dec = new FrameDecoder()
    const out: unknown[] = []
    for (const byte of frame) out.push(...dec.push(Uint8Array.of(byte)))
    expect(out).toEqual([{ type: 'hello', text: 'ünïcødé 🦉' }])
    expect(dec.pending).toBe(0)
  })

  it('refuses to encode an oversized message', () => {
    expect(() => encodeFrame('x'.repeat(MAX_FRAME_BYTES))).toThrow(FrameError)
  })

  it('rejects an oversized incoming length before buffering the body', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0)
    expect(() => new FrameDecoder().push(header)).toThrow(FrameError)
  })

  it('rejects bodies that are not JSON or not UTF-8', () => {
    const notJson = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from('{x}')])
    expect(() => new FrameDecoder().push(notJson)).toThrow(/JSON/)
    const notUtf8 = Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from([0xc3, 0x28])])
    expect(() => new FrameDecoder().push(notUtf8)).toThrow(/UTF-8/)
  })
})
