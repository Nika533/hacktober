import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import net from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { bridgePipePath, bridgeTokenPath, type Platform } from '@hoot/core'
import { runHost } from './relay'

/**
 * Entry point of hoot-bridge (built to dist/hoot-bridge.cjs, CommonJS so the
 * packaged app's own Electron binary can run it with ELECTRON_RUN_AS_NODE). Started by the
 * browser through the native messaging host manifest; see
 * scripts/register-native-host.mjs.
 *
 * Environment overrides (dev and tests): HOOT_BRIDGE_PIPE (pipe path),
 * HOOT_BRIDGE_DIR (token directory), HOOT_APP_PATH (app to launch).
 */
const platform = process.platform as Platform
const env = process.env

const pipePath =
  env['HOOT_BRIDGE_PIPE'] ??
  bridgePipePath(platform, userInfo().username, env['TMPDIR'] ?? tmpdir())

/** Packaged layout: <app>/resources/hoot-bridge.cjs next to <app>/Hoot.exe. */
function appPath(): string | null {
  if (env['HOOT_APP_PATH']) return env['HOOT_APP_PATH']
  const exe = platform === 'win32' ? 'Hoot.exe' : platform === 'darwin' ? '../MacOS/Hoot' : 'hoot'
  const candidate = join(dirname(__filename), '..', exe)
  return existsSync(candidate) ? candidate : null
}

void runHost({
  argv: process.argv.slice(2),
  stdin: process.stdin,
  stdout: process.stdout,
  log: (message) => process.stderr.write(`[hoot-bridge] ${message}\n`),
  async readToken() {
    try {
      const token = (await fs.readFile(bridgeTokenPath(platform, env), 'utf8')).trim()
      return token || null
    } catch {
      return null
    }
  },
  connect: () =>
    new Promise((resolve, reject) => {
      const socket = net.connect(pipePath)
      socket.once('connect', () => resolve(socket))
      socket.once('error', reject)
    }),
  async launchApp() {
    const app = appPath()
    if (!app) throw new Error('Hoot app not found next to hoot-bridge')
    const childEnv = { ...env }
    delete childEnv['ELECTRON_RUN_AS_NODE']
    spawn(app, ['--hidden'], { detached: true, stdio: 'ignore', env: childEnv }).unref()
  }
}).then((code) => {
  // Pipe writes are async on Windows: flush stdout before exiting.
  process.stdout.write('', () => process.exit(code))
})
