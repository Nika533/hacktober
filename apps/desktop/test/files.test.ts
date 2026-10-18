import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupCorrupt,
  readJson,
  writeBinaryAtomic,
  writeJsonAtomic
} from '../src/main/store/files'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hoot-files-'))
})

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await rm(dir, { recursive: true, force: true })
})

describe('readJson', () => {
  it('parses a valid file', async () => {
    const p = join(dir, 'a.json')
    await writeFile(p, '{"x":1}')
    const r = await readJson(p)
    expect(r).toEqual({ ok: true, value: { x: 1 } })
  })

  it('reports missing for an absent file', async () => {
    expect(await readJson(join(dir, 'nope.json'))).toEqual({ ok: false, reason: 'missing' })
  })

  it('reports corrupt for bad JSON', async () => {
    const p = join(dir, 'bad.json')
    await writeFile(p, '{not json')
    const r = await readJson(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('corrupt')
  })
})

describe('writeJsonAtomic', () => {
  it('creates parent dirs and leaves no tmp file', async () => {
    const p = join(dir, 'deep/nested/a.json')
    await writeJsonAtomic(p, { x: 1 })
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual({ x: 1 })
    const files = await readdir(join(dir, 'deep/nested'))
    expect(files).toEqual(['a.json'])
  })

  it('overwrites completely', async () => {
    const p = join(dir, 'a.json')
    await writeJsonAtomic(p, { long: 'old value with lots of bytes' })
    await writeJsonAtomic(p, { a: 1 })
    expect(JSON.parse(await readFile(p, 'utf8'))).toEqual({ a: 1 })
  })
})

describe('writeBinaryAtomic', () => {
  it('round-trips bytes', async () => {
    const p = join(dir, 'b.bin')
    const data = new Uint8Array([0, 1, 2, 255])
    await writeBinaryAtomic(p, data)
    expect(new Uint8Array(await readFile(p))).toEqual(data)
  })
})

describe('backupCorrupt', () => {
  it('renames <name>.json to <name>.corrupt-<ts>.json', async () => {
    const p = join(dir, 'settings.json')
    await writeFile(p, '{bad')
    const backup = await backupCorrupt(p)
    expect(backup).toMatch(/settings\.corrupt-.+\.json$/)
    expect(backup).not.toContain('settings.json.corrupt')
    await expect(readFile(p, 'utf8')).rejects.toThrow()
    expect(await readFile(backup, 'utf8')).toBe('{bad')
  })
})
