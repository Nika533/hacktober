import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { zipFiles } from '../scripts/zip.ts'

/** Reads a zip back through its central directory. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const start = local + 30 + zip.readUInt16LE(local + 26)
    const body = zip.subarray(start, start + size)
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body)
    expect(crc32(data)).toBe(crc)
    out.set(name, data)
    at += 46 + nameLength
  }
  return out
}

describe('zipFiles', () => {
  it('writes a zip that reads back byte for byte', () => {
    const files = [
      { name: 'manifest.json', data: Buffer.from('{"name":"Hoot Lens"}'.repeat(20)) },
      { name: 'pdfjs/cmaps/ß.bcmap', data: Buffer.from([0, 1, 2, 3]) },
      { name: 'empty.txt', data: Buffer.alloc(0) }
    ]
    const back = unzip(zipFiles(files))
    expect([...back.keys()]).toEqual(files.map((file) => file.name))
    for (const file of files) expect(back.get(file.name)?.equals(file.data)).toBe(true)
  })

  it('is deterministic', () => {
    const files = [{ name: 'a.js', data: Buffer.from('console.log(1)') }]
    expect(zipFiles(files).equals(zipFiles(files))).toBe(true)
  })
})
