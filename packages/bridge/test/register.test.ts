import { NATIVE_HOST_NAME } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import {
  applyRegistration,
  isRegistered,
  planRegistration,
  type RegistrationIO
} from '../src/register'

/** An in-memory filesystem and registry. */
function memoryIO(): RegistrationIO & { files: Map<string, string>; keys: Map<string, string> } {
  const files = new Map<string, string>()
  const keys = new Map<string, string>()
  return {
    files,
    keys,
    writeFile: async (path, data) => {
      files.set(path, data)
    },
    removeFile: async (path) => {
      files.delete(path)
    },
    readFile: async (path) => files.get(path) ?? null,
    reg: async ([op, key, ...rest]) => {
      if (!key) throw new Error('no key')
      if (op === 'add') keys.set(key, rest[rest.indexOf('/d') + 1] ?? '')
      else if (op === 'delete') {
        if (!keys.delete(key)) throw new Error('not found')
      } else if (op === 'query') {
        const value = keys.get(key)
        if (value === undefined) throw new Error('not found')
        return `\r\n${key}\r\n    (Default)    REG_SZ    ${value}\r\n`
      }
      return ''
    }
  }
}

const plan = planRegistration({
  platform: 'win32',
  home: 'C:\\Users\\u',
  localAppData: 'C:\\Users\\u\\AppData\\Local',
  launcherPath: 'C:\\Program Files\\Hoot\\resources\\hoot-bridge.cmd'
})

describe('native host registration', () => {
  it('writes one manifest and points all four browsers at it', async () => {
    const io = memoryIO()
    expect(await isRegistered(plan, io)).toBe(false)
    await applyRegistration(plan, io)
    const file = 'C:\\Users\\u\\AppData\\Local\\Hoot\\bridge\\' + `${NATIVE_HOST_NAME}.json`
    expect([...io.files.keys()]).toEqual([file])
    expect(JSON.parse(io.files.get(file) ?? '{}')).toMatchObject({
      name: NATIVE_HOST_NAME,
      path: 'C:\\Program Files\\Hoot\\resources\\hoot-bridge.cmd',
      type: 'stdio'
    })
    expect([...io.keys.values()]).toEqual([file, file, file, file])
    expect(await isRegistered(plan, io)).toBe(true)
  })

  it('notices a stale launcher path or a missing browser key', async () => {
    const io = memoryIO()
    await applyRegistration(plan, io)
    const moved = planRegistration({
      platform: 'win32',
      home: 'C:\\Users\\u',
      localAppData: 'C:\\Users\\u\\AppData\\Local',
      launcherPath: 'D:\\Hoot\\resources\\hoot-bridge.cmd'
    })
    expect(await isRegistered(moved, io)).toBe(false)

    io.keys.delete(plan.registryKeys[1] ?? '')
    expect(await isRegistered(plan, io)).toBe(false)
  })

  it('unregisters even when some browsers were never registered', async () => {
    const io = memoryIO()
    await applyRegistration(plan, io)
    io.keys.delete(plan.registryKeys[0] ?? '')
    await applyRegistration(plan, io, { unregister: true })
    expect(io.files.size).toBe(0)
    expect(io.keys.size).toBe(0)
  })

  it('fails loudly when a registry key cannot be written', async () => {
    const io = memoryIO()
    io.reg = async () => {
      throw new Error('access denied')
    }
    await expect(applyRegistration(plan, io)).rejects.toThrow(/could not write/)
  })
})
