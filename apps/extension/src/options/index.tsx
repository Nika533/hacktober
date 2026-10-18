/** Options page: site lists, quick toggles, connection status (D2-21). */
import '@hoot/ui/styles.css'
import './options.css'
import { HootUIProvider } from '@hoot/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExtensionBackend } from '../content/backend'
import { PAGE_ENABLED_KEY } from '../sw/page'
import { OptionsApp, type PageLinkSetting } from './App'

const root = document.getElementById('root')
const backend = new ExtensionBackend(chrome.runtime)
const pageLink: PageLinkSetting = {
  get: async () => (await chrome.storage.local.get(PAGE_ENABLED_KEY))[PAGE_ENABLED_KEY] !== false,
  set: (on) => chrome.storage.local.set({ [PAGE_ENABLED_KEY]: on })
}
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HootUIProvider>
        <OptionsApp source={backend} connection={backend} pageLink={pageLink} />
      </HootUIProvider>
    </StrictMode>
  )
}
