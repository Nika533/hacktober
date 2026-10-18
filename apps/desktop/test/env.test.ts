import { describe, expect, it } from 'vitest'
import { parseArgv, readEnv } from '../src/main/env'

describe('parseArgv', () => {
  it('finds --hidden anywhere in argv', () => {
    expect(
      parseArgv(['electron.exe', '--allow-file-access-from-files', '.', '--hidden']).hidden
    ).toBe(true)
  })

  it('matches --hidden=<value> by prefix', () => {
    expect(parseArgv(['electron.exe', '.', '--hidden=1']).hidden).toBe(true)
  })

  it('is false for a normal launch', () => {
    expect(parseArgv(['electron.exe', '.']).hidden).toBe(false)
  })

  it('ignores Electron-inserted flags and the app path', () => {
    // The app path is positional and must never be read as a flag.
    expect(parseArgv(['electron.exe', '--no-sandbox', 'C:\\apps\\hidden-dir']).hidden).toBe(false)
  })

  it('does not match a different flag with a shared prefix', () => {
    expect(parseArgv(['electron.exe', '.', '--hiddenx']).hidden).toBe(false)
  })
})

describe('readEnv', () => {
  const base = { argv: ['electron.exe', '.'], env: {} as NodeJS.ProcessEnv }

  it('reads the HOOT_* flags', () => {
    const env = readEnv(
      base.argv,
      {
        HOOT_TEST: '1',
        HOOT_FAKE_AI: '1',
        HOOT_FAKE_LENS: '1',
        HOOT_DEV_BRIDGE: '1',
        HOOT_FAKE_VOICE: '1',
        HOOT_USER_DATA: 'C:\\tmp\\hoot'
      } as NodeJS.ProcessEnv,
      true
    )
    expect(env).toEqual({
      hidden: false,
      test: true,
      fakeAi: true,
      fakeLens: true,
      devBridge: true,
      fakeVoice: true,
      userDataOverride: 'C:\\tmp\\hoot',
      isDev: false
    })
  })

  it('isDev needs unpackaged AND ELECTRON_RENDERER_URL', () => {
    expect(readEnv(base.argv, {}, false).isDev).toBe(false)
    expect(readEnv(base.argv, { ELECTRON_RENDERER_URL: 'http://localhost:5173' }, true).isDev).toBe(
      false
    )
    expect(
      readEnv(base.argv, { ELECTRON_RENDERER_URL: 'http://localhost:5173' }, false).isDev
    ).toBe(true)
  })

  it('only treats the literal "1" as on', () => {
    expect(readEnv(base.argv, { HOOT_TEST: 'true' } as NodeJS.ProcessEnv, false).test).toBe(false)
    expect(readEnv(base.argv, { HOOT_TEST: '0' } as NodeJS.ProcessEnv, false).test).toBe(false)
  })
})
