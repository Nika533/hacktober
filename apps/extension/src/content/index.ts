/**
 * Content script: runs @hoot/lens-dom on the page with the service worker as
 * its LensBackend. d2 wires it up in D2-15.
 */
import { UI_TAG, createLens, type Lens } from '@hoot/lens-dom'
import { ExtensionBackend } from './backend'
import { listenForPageLink } from './pageLink'
import { installSalt, pageHost, pageOrigin, pageSite, urlHash } from './page'

const LOADED = Symbol.for('hoot.lens.content')

type Scope = typeof globalThis & { [LOADED]?: Lens }

async function main(): Promise<void> {
  const scope = globalThis as Scope
  if (scope[LOADED] || document.contentType !== 'text/html' || !document.documentElement) return
  // The page link (Hoot reads the page when asked, highlights passages): top frame only.
  if (window.top === window) listenForPageLink(chrome.runtime, document, window)
  const backend = new ExtensionBackend(chrome.runtime)
  const origin = pageOrigin(location, globalThis.origin)
  const lens: Lens = createLens({
    document,
    backend,
    site: pageSite(location, origin),
    hostname: pageHost(location, origin),
    urlHash: urlHash({ origin, pathname: location.pathname }, await installSalt().catch(() => '')),
    shadowMode: __HOOT_E2E__ ? 'open' : 'closed',
    onError: () => {
      if (backend.connected) return
      lens.destroy()
      backend.destroy()
      delete scope[LOADED]
    }
  })
  scope[LOADED] = lens
  // e2e waits for this before selecting anything: until the settings are in, Lens ignores selections.
  if (__HOOT_E2E__) {
    void lens.ready.then(() => document.querySelector(UI_TAG)?.setAttribute('data-ready', ''))
  }
}

void main()
