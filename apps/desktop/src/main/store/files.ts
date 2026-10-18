import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'corrupt'; error: unknown }

/** JSON.parse failures report 'corrupt'; unreadable/absent files report 'missing'. */
export async function readJson(path: string): Promise<ReadResult<unknown>> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (error) {
    return { ok: false, reason: 'corrupt', error }
  }
}

async function writeAtomic(path: string, write: (tmp: string) => Promise<void>): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    await write(tmp)
    await fs.rename(tmp, path)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeAtomic(path, (tmp) => fs.writeFile(tmp, JSON.stringify(data, null, 0), 'utf8'))
}

export async function writeBinaryAtomic(path: string, data: Uint8Array): Promise<void> {
  await writeAtomic(path, (tmp) => fs.writeFile(tmp, data))
}

/** Quarantine a corrupt file next to itself; returns the backup path. */
export async function backupCorrupt(path: string): Promise<string> {
  const ts = new Date().toISOString().replace(/:/g, '-')
  const base = path.endsWith('.json') ? path.slice(0, -'.json'.length) : path
  const dest = `${base}.corrupt-${ts}.json`
  await fs.rename(path, dest)
  return dest
}
