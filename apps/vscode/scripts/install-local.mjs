/**
 * Installs the built extension into the local VS Code (run `build` first):
 * copies it to ~/.vscode/extensions/<publisher>.<name>-<version>, replacing
 * older copies, and registers it in the default profile's extensions.json
 * (VS Code deletes unregistered folders at startup). Then run
 * "Developer: Reload Window". `VSCODE_EXTENSIONS` overrides the folder.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = `${manifest.publisher}.${manifest.name}`
const folder = `${id}-${manifest.version}`
const extensions = process.env.VSCODE_EXTENSIONS || join(homedir(), '.vscode', 'extensions')
const target = join(extensions, folder)

if (!existsSync(join(root, 'dist', 'extension.js'))) throw new Error('dist/ is missing: run build')
mkdirSync(extensions, { recursive: true })
for (const name of readdirSync(extensions)) {
  if (name.toLowerCase().startsWith(`${id}-`)) {
    rmSync(join(extensions, name), { recursive: true, force: true })
  }
}
mkdirSync(target)
for (const file of ['package.json', 'README.md', 'dist']) {
  cpSync(join(root, file), join(target, file), { recursive: true })
}

const readJson = (path, fallback) =>
  existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8').trim() || 'null') ?? fallback)
    : fallback

const registry = join(extensions, 'extensions.json')
const entries = readJson(registry, []).filter((e) => e?.identifier?.id?.toLowerCase() !== id)
entries.push({
  identifier: { id },
  version: manifest.version,
  location: { $mid: 1, fsPath: target, path: pathToFileURL(target).pathname, scheme: 'file' },
  relativeLocation: folder,
  metadata: { installedTimestamp: Date.now(), source: 'vsix', pinned: true }
})
writeFileSync(registry, JSON.stringify(entries))

// An earlier uninstall leaves the folder name in .obsolete, which hides it.
const obsoletePath = join(extensions, '.obsolete')
const obsolete = readJson(obsoletePath, null)
if (obsolete) {
  for (const key of Object.keys(obsolete)) {
    if (key.toLowerCase().startsWith(`${id}-`)) delete obsolete[key]
  }
  writeFileSync(obsoletePath, JSON.stringify(obsolete))
}

console.log(`Installed ${id} ${manifest.version} → ${target}`)
console.log('In VS Code run "Developer: Reload Window".')
