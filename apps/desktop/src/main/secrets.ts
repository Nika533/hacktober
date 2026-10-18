import { promises as fs } from 'node:fs'
import type { Logger } from './log'
import { writeBinaryAtomic } from './store/files'

/** Test seam for `safeStorage` (only usable after `app.whenReady()`). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export interface SecretStore {
  /** Runs only after `app.whenReady()` — encryption is unavailable before. */
  load(): Promise<void>
  get(): string | null
  set(key: string): Promise<'os-encrypted' | 'memory'>
  clear(): Promise<void>
  readonly storage: 'os-encrypted' | 'memory'
  readonly source: 'file' | 'env' | 'memory' | 'none'
}

/**
 * The Claude (Anthropic) API key lives in `claude-key.bin`, encrypted by the OS via
 * safeStorage. Fallbacks, in order: the file, the `ANTHROPIC_API_KEY` env var
 * (dev, never written to disk), then memory-only when OS encryption is
 * unavailable. Never reads the legacy `secret.bin` (that was the old
 * Anthropic key).
 */
export function createSecretStore(deps: {
  file: string
  safeStorage: SafeStorageLike
  envKey: string | undefined
  log: Logger
}): SecretStore {
  const { file, safeStorage, envKey, log } = deps
  let key: string | null = null
  let source: 'file' | 'env' | 'memory' | 'none' = 'none'
  let warned = false

  const storage = (): 'os-encrypted' | 'memory' =>
    safeStorage.isEncryptionAvailable() ? 'os-encrypted' : 'memory'

  return {
    async load() {
      if (safeStorage.isEncryptionAvailable()) {
        let buf: Buffer | null = null
        try {
          buf = await fs.readFile(file)
        } catch {
          /* no key file yet */
        }
        if (buf) {
          try {
            const decrypted = safeStorage.decryptString(buf)
            if (decrypted) {
              key = decrypted
              source = 'file'
              return
            }
          } catch {
            const ts = new Date().toISOString().replace(/:/g, '-')
            const backup = file.replace(/\.bin$/, `.corrupt-${ts}.bin`)
            await fs.rename(file, backup).catch(() => {})
            log.warn(`the key file did not decrypt; moved to ${backup}`)
          }
        }
      }
      if (envKey && envKey.length > 0) {
        key = envKey
        source = 'env'
      }
    },

    get: () => key,

    async set(newKey) {
      if (safeStorage.isEncryptionAvailable()) {
        await writeBinaryAtomic(file, safeStorage.encryptString(newKey))
        key = newKey
        source = 'file'
        return 'os-encrypted'
      }
      key = newKey
      source = 'memory'
      if (!warned) {
        warned = true
        log.warn('OS encryption unavailable; the API key is held in memory only')
      }
      return 'memory'
    },

    async clear() {
      key = null
      source = 'none'
      await fs.rm(file, { force: true }).catch(() => {})
    },

    get storage() {
      return storage()
    },
    get source() {
      return source
    }
  }
}
