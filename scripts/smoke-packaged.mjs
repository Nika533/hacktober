/**
 * Packaged smoke test (F-C5). Starts the unpacked Windows build on the fakes and
 * checks what only a packaged app can break:
 *   1. the installer's registration command works with the app binary in
 *      Node mode (`--register` also writes and removes the real HKCU keys);
 *   2. the first window loads from hoot://app with no console errors
 *      (protocol, CSP and asar paths);
 *   3. the browser path: hoot-bridge.cmd, started the way Chrome starts it,
 *      authenticates and gets answers from the running app.
 *
 *   npm run build:unpack -w @hoot/desktop
 *   node scripts/smoke-packaged.mjs [--register]
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'

/** core's BRIDGE_PROTOCOL_VERSION */
const PROTOCOL = 1
const TIMEOUT_MS = 30_000

const root = join(import.meta.dirname, '..')
const appDir = join(root, 'apps/desktop/dist/win-unpacked')
const exe = join(appDir, 'hoot.exe')
const resources = join(appDir, 'resources')
const launcher = join(resources, 'hoot-bridge.cmd')

let failures = 0
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures++
}

if (process.platform !== 'win32') {
  console.error('The packaged smoke test runs on Windows only.')
  process.exit(1)
}
if (!existsSync(exe)) {
  console.error(`${exe} is missing: run npm run build:unpack -w @hoot/desktop first.`)
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'hoot-smoke-'))
const env = {
  ...process.env,
  HOOT_FAKE_AI: '1',
  HOOT_FAKE_LENS: '1',
  HOOT_USER_DATA: join(work, 'profile'),
  // Token and manifest in a scratch folder, never the developer's real one.
  HOOT_BRIDGE_DIR: join(work, 'bridge')
}

// 1. Registration, exactly as build/installer.nsh runs it.
const registerCli = (args) =>
  execFileSync(exe, [join(resources, 'register-native-host.cjs'), ...args], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
const plan = JSON.parse(registerCli(['--dry-run', '--launcher', launcher]))
check(plan.manifest.path === launcher, 'registration plan points at the packaged launcher')
const origin = plan.manifest.allowed_origins[0]
if (process.argv.includes('--register')) {
  registerCli(['--launcher', launcher])
  const registered = (key) => {
    try {
      return execFileSync('reg', ['query', key, '/ve'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).includes(plan.files[0])
    } catch {
      return false
    }
  }
  check(plan.registryKeys.every(registered), `HKCU keys for ${plan.registryKeys.length} browsers`)
  registerCli(['--unregister'])
  check(!plan.registryKeys.some(registered), 'uninstall removes the keys')
}

// 2. The app and its first window.
const app = await electron.launch({ executablePath: exe, env, timeout: TIMEOUT_MS })
const consoleErrors = []
try {
  const page = await app.firstWindow({ timeout: TIMEOUT_MS })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  await page.waitForFunction(
    () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
    null,
    {
      timeout: TIMEOUT_MS
    }
  )
  check(page.url().startsWith('hoot://app/'), `first window loads ${page.url()}`)

  // 3. The extension's path into the app.
  const replies = await talkThroughHost(origin, [
    {
      type: 'hello',
      reqId: 'smoke-hello',
      protocol: PROTOCOL,
      extVersion: 'smoke',
      browser: 'chrome'
    },
    { type: 'settings.get', reqId: 'smoke-settings' }
  ])
  // Replies can arrive in any order (welcome waits for the profile), so match by reqId.
  const hello = replies.get('smoke-hello')
  const settings = replies.get('smoke-settings')
  check(hello?.type === 'welcome', `hoot-bridge hello → ${hello?.type ?? 'no reply'}`)
  check(settings?.type === 'settings', `settings.get → ${settings?.type ?? 'no reply'}`)

  await page.waitForTimeout(500)
  check(
    consoleErrors.length === 0,
    `no console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`
  )
} finally {
  await app.close().catch(() => undefined)
  rmSync(work, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('packaged smoke passed')

/**
 * Start hoot-bridge the way Chrome does on Windows (cmd.exe, the caller's
 * origin as the first argument), send native-messaging frames (4-byte
 * little-endian length + JSON) and collect the replies by reqId.
 */
function talkThroughHost(callerOrigin, requests) {
  const hostEnv = { ...process.env, HOOT_BRIDGE_DIR: env.HOOT_BRIDGE_DIR }
  const host = spawn(
    process.env['ComSpec'] ?? 'cmd.exe',
    ['/d', '/s', '/c', `""${launcher}" ${callerOrigin} --parent-window=0"`],
    { env: hostEnv, windowsVerbatimArguments: true }
  )
  const replies = new Map()
  let buffer = Buffer.alloc(0)
  let stderr = ''
  host.stderr.on('data', (d) => (stderr += d))

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      host.stdin.end()
      if (replies.size < requests.length && stderr) console.log(stderr.trim())
      resolve(replies)
    }
    const timer = setTimeout(finish, TIMEOUT_MS)
    host.on('exit', finish)
    host.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0)
        if (buffer.length < 4 + length) break
        const message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'))
        buffer = buffer.subarray(4 + length)
        // Pushes have no reqId; keep only the replies.
        if (typeof message.reqId === 'string') replies.set(message.reqId, message)
        else if (message.type === 'error') {
          // A connection-level error (e.g. unauthorized): no reply will follow.
          console.log(`hoot-bridge: ${message.code}: ${message.message}`)
          finish()
          return
        }
        if (replies.size === requests.length) finish()
      }
    })
    for (const request of requests) {
      const body = Buffer.from(JSON.stringify(request), 'utf8')
      const header = Buffer.alloc(4)
      header.writeUInt32LE(body.length, 0)
      host.stdin.write(Buffer.concat([header, body]))
    }
  })
}
