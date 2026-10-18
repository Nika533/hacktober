import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  type Pin,
  type Session,
  type SessionMeta,
  type Settings
} from '@hoot/core'
import {
  IdSchema,
  migrateMessageError,
  migrateSettings,
  PinSchema,
  SessionMetaSchema,
  SessionSchema
} from '@hoot/core/schemas'
import type { Logger } from '../log'
import { backupCorrupt, readJson, writeBinaryAtomic, writeJsonAtomic } from './files'

/**
 * File layout under <root> (<userData>/hoot):
 *   settings.json
 *   sessions/index.json      { activeId, sessions: SessionMeta[] }
 *   sessions/<id>.json
 *   pins.json                Pin[]
 *   attachments/<id>.png
 *   gemini-key.bin           (owned by secrets.ts)
 */

export class PersistenceError extends Error {
  constructor(
    readonly kind: 'invalid-id' | 'write' | 'read',
    message: string,
    override readonly cause?: unknown
  ) {
    super(message)
    this.name = 'PersistenceError'
  }
}

export interface SessionIndex {
  activeId: string | null
  sessions: SessionMeta[]
}

export interface PersistenceDeps {
  root: string
  log: Logger
  /** saveHistory from settings; read at call time. */
  historyEnabled(): boolean
  /** Failures nobody awaits (debounced writes). */
  onError(e: PersistenceError): void
}

export interface Persistence {
  ensureDirs(): Promise<void>
  loadSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  loadSessionIndex(): Promise<SessionIndex>
  saveSessionIndex(i: SessionIndex): Promise<void>
  loadSession(id: string): Promise<Session | null>
  saveSession(s: Session): Promise<void>
  deleteSession(id: string): Promise<void>
  clearSessions(): Promise<void>
  loadPins(): Promise<Pin[]>
  savePins(p: Pin[]): Promise<void>
  attachmentPath(id: string): string
  saveAttachment(id: string, png: Uint8Array): Promise<void>
  readAttachment(id: string): Promise<Uint8Array | null>
  deleteAttachment(id: string): Promise<void>
}

const EMPTY_INDEX: SessionIndex = { activeId: null, sessions: [] }

const IndexFileSchema = z.object({
  activeId: IdSchema.nullable(),
  sessions: z.array(z.unknown())
})

/**
 * Prepare a session from disk for SessionSchema: legacy error strings go
 * through migrateMessageError, a message still 'streaming' was cut by a
 * crash (now 'stopped'), and legacy `attachments[*].path` is dropped (main
 * derives the path from the id). Everything else is SessionSchema's job.
 */
export function migrateSession(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const src = raw as Record<string, unknown>
  const out: Record<string, unknown> = { ...src }

  if (Array.isArray(src['messages'])) {
    out['messages'] = src['messages'].map((m) => {
      if (typeof m !== 'object' || m === null) return m
      const msg = { ...(m as Record<string, unknown>) }
      if (msg['status'] === 'streaming') msg['status'] = 'stopped'
      const migrated = migrateMessageError(msg['error'])
      if (migrated === undefined) delete msg['error']
      else msg['error'] = migrated
      return msg
    })
  }

  if (typeof src['attachments'] === 'object' && src['attachments'] !== null) {
    const atts: Record<string, unknown> = {}
    for (const [id, v] of Object.entries(src['attachments'])) {
      if (typeof v === 'object' && v !== null) {
        const a = { ...(v as Record<string, unknown>) }
        delete a['path']
        atts[id] = a
      } else atts[id] = v
    }
    out['attachments'] = atts
  }

  return out
}

export function createPersistence(deps: PersistenceDeps): Persistence {
  const { root, log } = deps
  const sessionsDir = join(root, 'sessions')
  const attachmentsDir = join(root, 'attachments')
  const settingsFile = join(root, 'settings.json')
  const indexFile = join(sessionsDir, 'index.json')
  const pinsFile = join(root, 'pins.json')

  const checkId = (id: string): void => {
    if (!IdSchema.safeParse(id).success)
      throw new PersistenceError('invalid-id', `refusing file name "${id}"`)
  }

  const attachmentPath = (id: string): string => {
    checkId(id)
    return join(attachmentsDir, `${id}.png`)
  }

  const writeJson = async (path: string, data: unknown): Promise<void> => {
    try {
      await writeJsonAtomic(path, data)
    } catch (cause) {
      const e = new PersistenceError('write', `writing ${path} failed`, cause)
      deps.onError(e)
      throw e
    }
  }

  /** Read + quarantine a corrupt file; returns the parsed value or falls back. */
  const backupAndWarn = async (path: string, what: string, error?: unknown): Promise<void> => {
    const backup = await backupCorrupt(path)
    log.warn(`${what} is corrupt${error ? ` (${String(error)})` : ''}; moved to ${backup}`)
  }

  return {
    async ensureDirs() {
      await fs.mkdir(sessionsDir, { recursive: true })
      await fs.mkdir(attachmentsDir, { recursive: true })
    },

    async loadSettings() {
      const r = await readJson(settingsFile)
      if (!r.ok) {
        if (r.reason === 'corrupt') await backupAndWarn(settingsFile, 'settings.json', r.error)
        return structuredClone(DEFAULT_SETTINGS)
      }
      // migrateSettings salvages valid fields one by one (a legacy v1 file's
      // Claude model id falls back to the default model).
      return migrateSettings(r.value)
    },

    saveSettings: (s) => writeJson(settingsFile, s),

    async loadSessionIndex() {
      const r = await readJson(indexFile)
      if (!r.ok) {
        if (r.reason === 'corrupt') await backupAndWarn(indexFile, 'sessions/index.json', r.error)
        return { ...EMPTY_INDEX }
      }
      const parsed = IndexFileSchema.safeParse(r.value)
      if (!parsed.success) {
        await backupAndWarn(indexFile, 'sessions/index.json')
        return { ...EMPTY_INDEX }
      }
      const kept: SessionMeta[] = []
      for (const entry of parsed.data.sessions) {
        const meta = SessionMetaSchema.safeParse(entry)
        if (meta.success) kept.push(meta.data)
      }
      const dropped = parsed.data.sessions.length - kept.length
      if (dropped > 0)
        log.warn(
          `sessions/index.json: dropped ${dropped} invalid entr${dropped === 1 ? 'y' : 'ies'}`
        )
      return { activeId: parsed.data.activeId, sessions: kept }
    },

    async saveSessionIndex(i) {
      if (!deps.historyEnabled()) return
      await writeJson(indexFile, i)
    },

    async loadSession(id) {
      checkId(id)
      const path = join(sessionsDir, `${id}.json`)
      const r = await readJson(path)
      if (!r.ok) {
        if (r.reason === 'corrupt') await backupAndWarn(path, `sessions/${id}.json`, r.error)
        return null
      }
      const parsed = SessionSchema.safeParse(migrateSession(r.value))
      if (!parsed.success) {
        await backupAndWarn(path, `sessions/${id}.json`, parsed.error)
        return null
      }
      return parsed.data
    },

    async saveSession(s) {
      if (!deps.historyEnabled()) return
      checkId(s.id)
      await writeJson(join(sessionsDir, `${s.id}.json`), s)
    },

    async deleteSession(id) {
      checkId(id)
      try {
        await fs.rm(join(sessionsDir, `${id}.json`), { force: true })
      } catch (cause) {
        const e = new PersistenceError('write', `deleting sessions/${id}.json failed`, cause)
        deps.onError(e)
        throw e
      }
    },

    async clearSessions() {
      try {
        const entries = await fs.readdir(sessionsDir).catch(() => [] as string[])
        await Promise.all(
          entries.filter((f) => f.endsWith('.json')).map((f) => fs.rm(join(sessionsDir, f)))
        )
        // The empty index is written even when history is off.
        await writeJsonAtomic(indexFile, EMPTY_INDEX)
      } catch (cause) {
        const e = new PersistenceError('write', 'clearing sessions failed', cause)
        deps.onError(e)
        throw e
      }
    },

    async loadPins() {
      const r = await readJson(pinsFile)
      if (!r.ok) {
        if (r.reason === 'corrupt') await backupAndWarn(pinsFile, 'pins.json', r.error)
        return []
      }
      if (!Array.isArray(r.value)) {
        await backupAndWarn(pinsFile, 'pins.json')
        return []
      }
      const kept: Pin[] = []
      for (const entry of r.value) {
        const pin = PinSchema.safeParse(entry)
        if (pin.success) kept.push(pin.data)
      }
      const dropped = r.value.length - kept.length
      if (dropped > 0)
        log.warn(`pins.json: dropped ${dropped} invalid entr${dropped === 1 ? 'y' : 'ies'}`)
      return kept
    },

    savePins: (p) => writeJson(pinsFile, p),

    attachmentPath,

    async saveAttachment(id, png) {
      const path = attachmentPath(id)
      try {
        await writeBinaryAtomic(path, png)
      } catch (cause) {
        const e = new PersistenceError('write', `writing attachments/${id}.png failed`, cause)
        deps.onError(e)
        throw e
      }
    },

    async readAttachment(id) {
      try {
        return await fs.readFile(attachmentPath(id))
      } catch {
        return null
      }
    },

    async deleteAttachment(id) {
      try {
        await fs.rm(attachmentPath(id), { force: true })
      } catch (cause) {
        const e = new PersistenceError('write', `deleting attachments/${id}.png failed`, cause)
        deps.onError(e)
        throw e
      }
    }
  }
}
