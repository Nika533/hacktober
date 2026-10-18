import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import {
  NATIVE_HOST_NAME,
  allowedExtensionIds,
  bridgeDir,
  extensionOrigin,
  type Platform
} from '@hoot/core'

export interface NativeHostManifest {
  name: string
  description: string
  path: string
  type: 'stdio'
  allowed_origins: string[]
}

/** The JSON manifest Chrome-family browsers read to find hoot-bridge. */
export function nativeHostManifest(
  launcherPath: string,
  extensionIds: readonly string[] = allowedExtensionIds()
): NativeHostManifest {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Hoot Lens: connects the browser extension to the Hoot desktop app',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: extensionIds.map(extensionOrigin)
  }
}

export interface RegistrationPlan {
  manifest: NativeHostManifest
  /** Files to write (manifest copies; on Windows one file, referenced from the registry) */
  files: string[]
  /** Windows only: HKCU keys whose default value is the manifest path */
  registryKeys: string[]
}

const WINDOWS_KEYS = [
  'Google\\Chrome',
  'Microsoft\\Edge',
  'Chromium',
  'BraveSoftware\\Brave-Browser'
].map((b) => `HKCU\\Software\\${b}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`)

const MAC_DIRS = ['Google/Chrome', 'Microsoft Edge', 'Chromium', 'BraveSoftware/Brave-Browser']
const LINUX_DIRS = ['google-chrome', 'microsoft-edge', 'chromium', 'BraveSoftware/Brave-Browser']

/** Where the manifest goes for Chrome, Edge, Chromium and Brave (per user). */
export function planRegistration(opts: {
  platform: Platform
  home: string
  localAppData?: string
  launcherPath: string
  extensionIds?: readonly string[]
}): RegistrationPlan {
  const manifest = nativeHostManifest(opts.launcherPath, opts.extensionIds)
  const file = `${NATIVE_HOST_NAME}.json`
  if (opts.platform === 'win32') {
    const dir = bridgeDir('win32', { LOCALAPPDATA: opts.localAppData })
    return { manifest, files: [`${dir}\\${file}`], registryKeys: WINDOWS_KEYS }
  }
  const dirs =
    opts.platform === 'darwin'
      ? MAC_DIRS.map((d) => `${opts.home}/Library/Application Support/${d}/NativeMessagingHosts`)
      : LINUX_DIRS.map((d) => `${opts.home}/.config/${d}/NativeMessagingHosts`)
  return { manifest, files: dirs.map((d) => `${d}/${file}`), registryKeys: [] }
}

/** The side effects of registering, injectable for tests. */
export interface RegistrationIO {
  writeFile(path: string, data: string): Promise<void>
  removeFile(path: string): Promise<void>
  /** Null when the file doesn't exist. */
  readFile(path: string): Promise<string | null>
  /** Runs `reg.exe` with these arguments and returns its stdout; rejects on failure. */
  reg(args: readonly string[]): Promise<string>
}

const run = promisify(execFile)

export const nodeRegistrationIO: RegistrationIO = {
  async writeFile(path, data) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  },
  removeFile: (path) => rm(path, { force: true }),
  readFile: (path) => readFile(path, 'utf8').catch(() => null),
  reg: async (args) => (await run('reg', [...args], { windowsHide: true })).stdout
}

const manifestText = (plan: RegistrationPlan): string => JSON.stringify(plan.manifest, null, 2)

/** Write (or with `unregister`, remove) the manifest files and registry keys of a plan. */
export async function applyRegistration(
  plan: RegistrationPlan,
  io: RegistrationIO,
  opts: { unregister?: boolean } = {}
): Promise<void> {
  for (const file of plan.files) {
    if (opts.unregister) await io.removeFile(file)
    else await io.writeFile(file, manifestText(plan))
  }
  for (const key of plan.registryKeys) {
    if (opts.unregister) {
      // A browser that was never registered has no key; that's fine.
      await io.reg(['delete', key, '/f']).catch(() => undefined)
    } else {
      await io
        .reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', plan.files[0] ?? '', '/f'])
        .catch(() => {
          throw new Error(`could not write ${key}`)
        })
    }
  }
}

/** True when every manifest file and registry key already says what the plan would write. */
export async function isRegistered(plan: RegistrationPlan, io: RegistrationIO): Promise<boolean> {
  for (const file of plan.files) {
    if ((await io.readFile(file)) !== manifestText(plan)) return false
  }
  const target = (plan.files[0] ?? '').toLowerCase()
  for (const key of plan.registryKeys) {
    // `reg query` localises the "(Default)" label, so look for the path itself.
    const out = await io.reg(['query', key, '/ve']).catch(() => '')
    if (!out.toLowerCase().includes(target)) return false
  }
  return true
}
