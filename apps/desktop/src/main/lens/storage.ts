import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the Lens keeps its files (`<userData>/hoot/lens/`). Injected so
 * tests use a temp dir and d1's AppContext can supply its own persistence.
 * Names are bare file names; anything path-like is refused.
 */
export interface LensStorage {
  /** Parsed JSON, or null when the file doesn't exist or isn't valid JSON. */
  readJson(name: string): Promise<unknown>
  /** Atomic: written to a unique temp file, then renamed over the target. */
  writeJson(name: string, data: unknown): Promise<void>
  appendLine(name: string, line: string): Promise<void>
  list(): Promise<string[]>
  remove(name: string): Promise<void>
  /** Absolute path, for "Export" and diagnostics only. */
  pathOf(name: string): string
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function check(name: string): string {
  if (!SAFE_NAME.test(name) || name.includes('..')) throw new Error(`bad lens file name: ${name}`)
  return name
}

export function createFsLensStorage(dir: string): LensStorage {
  let ready: Promise<void> | null = null
  const ensureDir = (): Promise<void> =>
    (ready ??= fs.mkdir(dir, { recursive: true }).then(() => undefined))

  return {
    async readJson(name) {
      try {
        return JSON.parse(await fs.readFile(join(dir, check(name)), 'utf8'))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        if (e instanceof SyntaxError) return null
        throw e
      }
    },
    async writeJson(name, data) {
      await ensureDir()
      const target = join(dir, check(name))
      const tmp = `${target}.tmp-${randomUUID()}`
      await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
      await fs.rename(tmp, target)
    },
    async appendLine(name, line) {
      await ensureDir()
      await fs.appendFile(join(dir, check(name)), `${line.replace(/\n/g, ' ')}\n`, 'utf8')
    },
    async list() {
      try {
        return (await fs.readdir(dir)).filter((n) => SAFE_NAME.test(n))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw e
      }
    },
    async remove(name) {
      await fs.rm(join(dir, check(name)), { force: true })
    },
    pathOf(name) {
      return join(dir, check(name))
    }
  }
}

/** In-memory storage for tests. */
export function createMemoryLensStorage(): LensStorage & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    async readJson(name) {
      const raw = files.get(check(name))
      if (raw === undefined) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    },
    async writeJson(name, data) {
      files.set(check(name), JSON.stringify(data))
    },
    async appendLine(name, line) {
      files.set(check(name), `${files.get(name) ?? ''}${line.replace(/\n/g, ' ')}\n`)
    },
    async list() {
      return [...files.keys()]
    },
    async remove(name) {
      files.delete(check(name))
    },
    pathOf(name) {
      return `memory:${check(name)}`
    }
  }
}
