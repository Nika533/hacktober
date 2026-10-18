/**
 * Some hosts export ELECTRON_RUN_AS_NODE=1, which makes electron.exe run
 * in Node mode and breaks `dev`/`preview`. Spawn the child with that
 * variable stripped.
 *
 * The package bin is resolved to its JS entry so no shell shim
 * (`.cmd`, which can't be spawned without a shell) is needed.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('usage: node scripts/run-electron.mjs <cmd> [args...]')
  process.exit(1)
}

function binJs(name) {
  let dir
  try {
    dir = path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    dir = path.resolve('node_modules', name)
  }
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const rel =
    typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.[name] ?? Object.values(pkg.bin ?? {})[0])
  return rel ? path.join(dir, rel) : null
}

let child
try {
  const bin = binJs(cmd)
  if (!bin) throw new Error('no bin')
  child = spawn(process.execPath, [bin, ...args], { stdio: 'inherit', env })
} catch {
  child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
