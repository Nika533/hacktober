import { promises as fs } from 'fs'
import path from 'path'
import type { Pin, Session, SessionMeta, Settings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'

/**
 * File layout under <root>:
 *   settings.json
 *   sessions/index.json      { activeId, sessions: SessionMeta[] }
 *   sessions/<id>.json
 *   pins.json
 *   attachments/<id>.png
 *   secret.bin
 */
export interface SessionIndex {
  activeId: string | null
  sessions: SessionMeta[]
}

export class Persistence {
  constructor(private root: string) {}

  private p(...parts: string[]): string {
    return path.join(this.root, ...parts)
  }

  async ensureDirs(): Promise<void> {
    await fs.mkdir(this.p('sessions'), { recursive: true })
    await fs.mkdir(this.p('attachments'), { recursive: true })
  }

  /** Atomic write: tmp + rename. */
  async writeJson(rel: string, data: unknown): Promise<void> {
    const file = this.p(rel)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    await fs.writeFile(tmp, JSON.stringify(data, null, 0), 'utf8')
    await fs.rename(tmp, file)
  }

  async readJson<T>(rel: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(this.p(rel), 'utf8')
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async writeBinary(rel: string, data: Buffer): Promise<void> {
    const file = this.p(rel)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file)
  }

  async readBinary(rel: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.p(rel))
    } catch {
      return null
    }
  }

  async remove(rel: string): Promise<void> {
    try {
      await fs.rm(this.p(rel), { force: true })
    } catch {
      /* ignore */
    }
  }

  async loadSettings(): Promise<Settings> {
    const raw = await this.readJson<Partial<Settings>>('settings.json')
    return { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.writeJson('settings.json', settings)
  }

  async loadSessionIndex(): Promise<SessionIndex> {
    const raw = await this.readJson<SessionIndex>(path.join('sessions', 'index.json'))
    return raw ?? { activeId: null, sessions: [] }
  }

  saveSessionIndex(index: SessionIndex): Promise<void> {
    return this.writeJson(path.join('sessions', 'index.json'), index)
  }

  async loadSession(id: string): Promise<Session | null> {
    return this.readJson<Session>(path.join('sessions', `${id}.json`))
  }

  saveSession(session: Session): Promise<void> {
    return this.writeJson(path.join('sessions', `${session.id}.json`), session)
  }

  deleteSessionFile(id: string): Promise<void> {
    return this.remove(path.join('sessions', `${id}.json`))
  }

  /** Remove every session file and reset the index. */
  async clearSessions(): Promise<void> {
    try {
      const dir = this.p('sessions')
      for (const f of await fs.readdir(dir)) {
        if (f.endsWith('.json')) await fs.rm(path.join(dir, f), { force: true })
      }
    } catch {
      /* ignore */
    }
    await this.saveSessionIndex({ activeId: null, sessions: [] })
  }

  async loadPins(): Promise<Pin[]> {
    return (await this.readJson<Pin[]>('pins.json')) ?? []
  }

  savePins(pins: Pin[]): Promise<void> {
    return this.writeJson('pins.json', pins)
  }

  attachmentPath(id: string): string {
    return this.p('attachments', `${id}.png`)
  }

  saveAttachment(id: string, png: Buffer): Promise<void> {
    return this.writeBinary(path.join('attachments', `${id}.png`), png)
  }

  readAttachment(id: string): Promise<Buffer | null> {
    return this.readBinary(path.join('attachments', `${id}.png`))
  }

  secretPath(): string {
    return this.p('secret.bin')
  }
}

/** Debounced writer: coalesces structural writes (300 ms). */
export class DebouncedWriter {
  private timers = new Map<string, NodeJS.Timeout>()
  private pending = new Map<string, () => Promise<void>>()

  constructor(private delayMs = 300) {}

  schedule(key: string, write: () => Promise<void>): void {
    this.pending.set(key, write)
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        const fn = this.pending.get(key)
        this.pending.delete(key)
        if (fn) void fn().catch(() => {})
      }, this.delayMs)
    )
  }

  async flush(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    const jobs = [...this.pending.values()]
    this.pending.clear()
    await Promise.all(jobs.map((fn) => fn().catch(() => {})))
  }
}
