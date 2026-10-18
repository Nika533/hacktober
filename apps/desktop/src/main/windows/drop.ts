import { fileURLToPath } from 'node:url'
import { kindFromName } from '../services/reader'

/**
 * A dropped file Chromium tries to navigate the page to (F-D1-6): file:
 * URLs only, Reader extensions only — anything else isn't a drop we own.
 */
export function readerPathFromNavigation(url: string): string | null {
  if (!url.startsWith('file:')) return null
  let path: string
  try {
    // URL drops ?query/#hash; fileURLToPath decodes %20 and UNC hosts.
    path = fileURLToPath(new URL(url))
  } catch {
    return null
  }
  return kindFromName(path) === null ? null : path
}

/**
 * "Open with Hoot" / `hoot.exe doc.pdf`: the first argv item that is a real
 * file with a Reader extension. argv[0] is always the executable and `--`
 * flags never count, so packaged, dev and second-instance argv all work.
 */
export function fileArgFromArgv(
  argv: readonly string[],
  exists: (path: string) => boolean
): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    const path = arg.startsWith('file:') ? readerPathFromNavigation(arg) : arg
    if (path === null || kindFromName(path) === null) continue
    if (exists(path)) return path
  }
  return null
}
