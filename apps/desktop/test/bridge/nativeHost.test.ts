import type { RegistrationIO } from '@hoot/bridge'
import { describe, expect, it } from 'vitest'
import { ensureNativeHost } from '../../src/main/bridge'

function memoryIO(): RegistrationIO & { writes: number } {
  const files = new Map<string, string>()
  const keys = new Map<string, string>()
  const io = {
    writes: 0,
    writeFile: async (path: string, data: string) => {
      io.writes++
      files.set(path, data)
    },
    removeFile: async (path: string) => {
      files.delete(path)
    },
    readFile: async (path: string) => files.get(path) ?? null,
    reg: async ([op, key = '', ...rest]: readonly string[]) => {
      if (op === 'add') keys.set(key, rest[rest.indexOf('/d') + 1] ?? '')
      if (op === 'query') {
        const v = keys.get(key)
        if (v === undefined) throw new Error('not found')
        return `REG_SZ    ${v}`
      }
      return ''
    }
  }
  return io
}

const deps = {
  platform: 'win32' as const,
  resourcesPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\Hoot\\resources',
  home: 'C:\\Users\\u',
  localAppData: 'C:\\Users\\u\\AppData\\Local'
}

describe('ensureNativeHost', () => {
  it('registers the packaged launcher once, then leaves it alone', async () => {
    const io = memoryIO()
    const log: string[] = []
    expect(await ensureNativeHost({ ...deps, io, log: (m) => log.push(m) })).toBe('registered')
    expect(log[0]).toContain('Hoot\\resources\\hoot-bridge.cmd')
    expect(await ensureNativeHost({ ...deps, io })).toBe('current')
    expect(io.writes).toBe(1)
  })

  it('re-registers after the app moved', async () => {
    const io = memoryIO()
    await ensureNativeHost({ ...deps, io })
    expect(await ensureNativeHost({ ...deps, resourcesPath: 'D:\\Hoot\\resources', io })).toBe(
      'registered'
    )
  })

  it('never throws, and does nothing off Windows', async () => {
    const io = memoryIO()
    io.reg = async () => {
      throw new Error('denied')
    }
    expect(await ensureNativeHost({ ...deps, io })).toBe('failed')
    expect(await ensureNativeHost({ ...deps, platform: 'darwin', io })).toBe('unsupported')
  })
})
