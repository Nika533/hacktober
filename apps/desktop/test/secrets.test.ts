import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '../src/main/log'
import { createSecretStore, type SafeStorageLike } from '../src/main/secrets'

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} }

/** Fake safeStorage: reversible "encryption" (base64 with a marker prefix). */
const makeSafeStorage = (available: boolean): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
  decryptString: (b) => {
    const s = b.toString('utf8')
    if (!s.startsWith('enc:')) throw new Error('cannot decrypt')
    return s.slice(4)
  }
})

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hoot-secrets-'))
  file = join(dir, 'claude-key.bin')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('SecretStore', () => {
  it('no file, no env → none / null', async () => {
    const store = createSecretStore({
      file,
      safeStorage: makeSafeStorage(true),
      envKey: undefined,
      log: silent
    })
    await store.load()
    expect(store.get()).toBeNull()
    expect(store.source).toBe('none')
    expect(store.storage).toBe('os-encrypted')
  })

  it('set() encrypts to disk when available, and reloads from file', async () => {
    const ss = makeSafeStorage(true)
    const store = createSecretStore({ file, safeStorage: ss, envKey: undefined, log: silent })
    await store.load()
    expect(await store.set('sk-test')).toBe('os-encrypted')
    expect(store.source).toBe('file')

    // A fresh store reads the key back.
    const next = createSecretStore({ file, safeStorage: ss, envKey: undefined, log: silent })
    await next.load()
    expect(next.get()).toBe('sk-test')
    expect(next.source).toBe('file')
  })

  it('encryption unavailable → memory-only, storage memory', async () => {
    const ss = makeSafeStorage(false)
    const warnings: Logger = { ...silent, warn: vi.fn() }
    const store = createSecretStore({ file, safeStorage: ss, envKey: undefined, log: warnings })
    await store.load()
    expect(await store.set('sk-test')).toBe('memory')
    expect(store.get()).toBe('sk-test')
    expect(store.source).toBe('memory')
    expect(store.storage).toBe('memory')
    // Never written to disk.
    expect(await readdir(dir)).toEqual([])
    expect(warnings.warn).toHaveBeenCalledTimes(1)
  })

  it('env key is a fallback when no file exists; file wins when both exist', async () => {
    const ss = makeSafeStorage(true)
    await writeFile(file, ss.encryptString('file-key'))
    const fromFile = createSecretStore({ file, safeStorage: ss, envKey: 'env-key', log: silent })
    await fromFile.load()
    expect(fromFile.get()).toBe('file-key')
    expect(fromFile.source).toBe('file')

    const fromEnv = createSecretStore({
      file: join(dir, 'nothing.bin'),
      safeStorage: ss,
      envKey: 'env-key',
      log: silent
    })
    await fromEnv.load()
    expect(fromEnv.get()).toBe('env-key')
    expect(fromEnv.source).toBe('env')
    // The env key is never written to disk.
    await expect(readFile(join(dir, 'nothing.bin'))).rejects.toThrow()
  })

  it('an undecryptable file is backed up and treated as none', async () => {
    await writeFile(file, Buffer.from('garbage'))
    const store = createSecretStore({
      file,
      safeStorage: makeSafeStorage(true),
      envKey: undefined,
      log: silent
    })
    await store.load()
    expect(store.get()).toBeNull()
    expect(store.source).toBe('none')
    const backups = (await readdir(dir)).filter((f) => f.startsWith('claude-key.corrupt-'))
    expect(backups.length).toBe(1)
    expect(backups[0]).toMatch(/\.bin$/)
  })

  it('env fallback kicks in when encryption is unavailable', async () => {
    const store = createSecretStore({
      file,
      safeStorage: makeSafeStorage(false),
      envKey: 'env-key',
      log: silent
    })
    await store.load()
    expect(store.get()).toBe('env-key')
    expect(store.source).toBe('env')
    expect(store.storage).toBe('memory')
  })

  it('clear() removes the file and the memory key', async () => {
    const ss = makeSafeStorage(true)
    const store = createSecretStore({ file, safeStorage: ss, envKey: undefined, log: silent })
    await store.set('sk-test')
    await store.clear()
    expect(store.get()).toBeNull()
    expect(store.source).toBe('none')
    expect(await readdir(dir)).toEqual([])
  })
})
