import { chmodSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { NATIVE_HOST_NAME, type Platform } from '@hoot/core'
import { applyRegistration, nodeRegistrationIO, planRegistration } from './register'

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
 * The register-host CLI, built to dist/register-native-host.cjs:
 * `npm run register-host -w @hoot/bridge [-- --unregister] [--launcher <path>] [--dry-run]`
 * Registers hoot-bridge for the current user. Without `--launcher` it points
 * at a dev launcher for dist/hoot-bridge.cjs. The installer runs it with the
 * app's own binary in Node mode and the packaged `resources/hoot-bridge.cmd`
 * (apps/desktop/build/installer.nsh).
 */
async function main(): Promise<void> {
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
  await applyRegistration(plan, nodeRegistrationIO, { unregister: flag('--unregister') })
  console.log(
    flag('--unregister')
      ? `Unregistered ${NATIVE_HOST_NAME}.`
      : `Registered ${NATIVE_HOST_NAME} → ${plan.manifest.path}\nAllowed: ${plan.manifest.allowed_origins.join(', ')}`
  )
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
