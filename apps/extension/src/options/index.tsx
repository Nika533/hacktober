/** Options page: site lists, quick toggles, connection status (D2-21). */
import '@hoot/ui/styles.css'
import './options.css'
import { HootUIProvider } from '@hoot/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExtensionBackend } from '../content/backend'
import { OptionsApp } from './App'

const root = document.getElementById('root')
const backend = new ExtensionBackend(chrome.runtime)
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HootUIProvider>
        <OptionsApp source={backend} connection={backend} />
      </HootUIProvider>
    </StrictMode>
  )
}
