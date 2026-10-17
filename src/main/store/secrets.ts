import { safeStorage } from 'electron'
import { promises as fs } from 'fs'

/**
 * Gemini API key storage: safeStorage-encrypted gemini-key.bin.
 * Fallbacks: GEMINI_API_KEY env var, then in-memory only when the OS
 * encryption backend is unavailable (never written to disk in that case).
 */
export class SecretStore {
  private memoryKey: string | null = null

  constructor(private secretFile: string) {}

  get storageMode(): 'os-encrypted' | 'memory' {
    return safeStorage.isEncryptionAvailable() ? 'os-encrypted' : 'memory'
  }

  async getKey(): Promise<string | null> {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const buf = await fs.readFile(this.secretFile)
        const key = safeStorage.decryptString(buf)
        if (key) return key
      } catch {
        /* no key on disk yet */
      }
    }
    if (this.memoryKey) return this.memoryKey
    const env = process.env.GEMINI_API_KEY
    return env && env.length > 0 ? env : null
  }

  async setKey(key: string): Promise<void> {
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(key)
      const tmp = `${this.secretFile}.tmp-${process.pid}`
      await fs.writeFile(tmp, enc)
      await fs.rename(tmp, this.secretFile)
    } else {
      this.memoryKey = key
    }
  }

  async clearKey(): Promise<void> {
    this.memoryKey = null
    try {
      await fs.rm(this.secretFile, { force: true })
    } catch {
      /* ignore */
    }
  }
}
