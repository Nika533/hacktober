/**
 * Content script: runs @hoot/lens-dom on the page with the service worker as
 * its LensBackend. d2 wires it up in D2-15.
 */
import { createLens, type Lens } from '@hoot/lens-dom'
import { ExtensionBackend } from './backend'
import { pageSite, urlHash } from './page'

const LOADED = Symbol.for('hoot.lens.content')
const SALT_KEY = 'lens.salt'

type Scope = typeof globalThis & { [LOADED]?: Lens }

async function salt(): Promise<string> {
  const stored = await chrome.storage.local.get(SALT_KEY)
  const existing = stored[SALT_KEY]
  if (typeof existing === 'string' && existing) return existing
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
  await chrome.storage.local.set({ [SALT_KEY]: fresh })
  return fresh
}

async function main(): Promise<void> {
  const scope = globalThis as Scope
  if (scope[LOADED] || document.contentType !== 'text/html' || !document.documentElement) return
  const backend = new ExtensionBackend(chrome.runtime)
  const lens: Lens = createLens({
    document,
    backend,
    site: pageSite(location),
    urlHash: urlHash(location, await salt().catch(() => '')),
    shadowMode: __HOOT_E2E__ ? 'open' : 'closed',
    onError: () => {
      if (backend.connected) return
      lens.destroy()
      backend.destroy()
      delete scope[LOADED]
    }
  })
  scope[LOADED] = lens
}

void main()
