/**
 * Packs dist/ into release/hoot-lens-<version>.zip for the Chrome Web Store
 * and Edge Add-ons (or for sharing a load-unpacked build). Run after
 * `npm run build`. Entries are sorted and dated 1980-01-01, so the same
 * build always gives the same zip.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const DOS_DATE_1980 = 0x21

/** A minimal ZIP writer (deflate or store, UTF-8 names, no ZIP64). */
export interface ZipEntry {
  name: string
  data: Buffer
}

export function zipFiles(files: readonly ZipEntry[]): Buffer {
  const records: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(data, { level: 9 })
    const method = deflated.length < data.length ? 8 : 0
    const body = method === 8 ? deflated : data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE_1980, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    records.push(local, nameBytes, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt16LE(0, 12)
    entry.writeUInt16LE(DOS_DATE_1980, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBytes)
    offset += local.length + nameBytes.length + body.length
  }
  const size = central.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...records, ...central, end])
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dist = join(root, 'dist')
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  if (manifest.name.includes('(e2e)')) {
    throw new Error('dist/ is an e2e build; run `npm run build` first')
  }
  const files = walk(dist)
    .map((path) => ({ name: relative(dist, path).split(sep).join('/'), data: readFileSync(path) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const out = join(root, 'release', `hoot-lens-${manifest.version}.zip`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, zipFiles(files))
  console.log(`${relative(root, out)}: ${files.length} files`)
}
