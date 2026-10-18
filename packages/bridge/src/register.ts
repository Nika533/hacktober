import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

/** A dev launcher that runs the built bridge with the current Node. */
function writeDevLauncher(platform: Platform, distDir: string): string {
  const host = join(distDir, 'hoot-bridge.cjs')
  if (platform === 'win32') {
    const path = join(distDir, 'hoot-bridge-dev.cmd')
    writeFileSync(path, `@echo off\r\n"${process.execPath}" "${host}" %*\r\n`)
    return path
  }
  const path = join(distDir, 'hoot-bridge-dev.sh')
  writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${host}" "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

/**
 * `npm run register-host -w @hoot/bridge [-- --unregister] [--launcher <path>] [--dry-run]`
 * Registers hoot-bridge for the current user. Without `--launcher` it points
 * at a dev launcher for dist/hoot-bridge.cjs. The installer (D1-30) does the
 * same with the packaged `resources/hoot-bridge.cmd`.
 */
function main(): void {
  const args = process.argv.slice(2)
  const flag = (name: string): boolean => args.includes(name)
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const platform = process.platform as Platform
  const distDir = dirname(resolve(process.argv[1] ?? '.'))
  const sideEffects = !flag('--unregister') && !flag('--dry-run')
  const launcherPath =
    value('--launcher') ??
    (sideEffects ? writeDevLauncher(platform, distDir) : join(distDir, 'hoot-bridge-dev'))
  const plan = planRegistration({
    platform,
    home: homedir(),
    localAppData: process.env['LOCALAPPDATA'],
    launcherPath: launcherPath ? resolve(launcherPath) : ''
  })

  if (flag('--dry-run')) {
    console.log(JSON.stringify(plan, null, 2))
    return
  }
  for (const file of plan.files) {
    if (flag('--unregister')) rmSync(file, { force: true })
    else {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(plan.manifest, null, 2))
    }
  }
  for (const key of plan.registryKeys) {
    const cmd = flag('--unregister')
      ? ['delete', key, '/f']
      : ['add', key, '/ve', '/t', 'REG_SZ', '/d', plan.files[0] ?? '', '/f']
    try {
      execFileSync('reg', cmd, { stdio: 'ignore' })
    } catch {
      if (!flag('--unregister')) throw new Error(`could not write ${key}`)
    }
  }
  console.log(
    flag('--unregister')
      ? `Unregistered ${NATIVE_HOST_NAME}.`
      : `Registered ${NATIVE_HOST_NAME} → ${plan.manifest.path}\nAllowed: ${plan.manifest.allowed_origins.join(', ')}`
  )
}

if (require.main === module) main()
