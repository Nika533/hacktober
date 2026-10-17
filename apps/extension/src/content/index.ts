import { LensError, createLens, type Lens } from '@hoot/lens-dom'
import { ExtensionBackend } from './backend'

const LOADED = Symbol.for('hoot.lens.content')

type Scope = typeof globalThis & { [LOADED]?: Lens }

async function main(): Promise<void> {
  const scope = globalThis as Scope
  if (scope[LOADED] || document.contentType !== 'text/html' || !document.documentElement) return
  const backend = new ExtensionBackend(chrome.runtime)
  const site = location.hostname || 'local'
  const paused = await backend.sitePaused(site).catch(() => false)
  const lens: Lens = createLens({
    document,
    backend,
    shadowMode: __HOOT_DEV__ ? 'open' : 'closed',
    paused,
    onPauseChange: (next) => void backend.setSitePaused(site, next).catch(() => undefined),
    onError: (error) => {
      if (error instanceof LensError && error.code === 'extension-reloaded') {
        lens.destroy()
        backend.destroy()
        delete scope[LOADED]
      }
    }
  })
  scope[LOADED] = lens
}

void main()
