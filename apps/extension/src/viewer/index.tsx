/** PDF viewer page: @hoot/pdf-view + lens-dom (D2-31, D3-30). */
import '@hoot/ui/styles.css'
import '@hoot/pdf-view/styles.css'
import './viewer.css'
import { HootUIProvider } from '@hoot/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ExtensionBackend } from '../content/backend'
import { Viewer } from './Viewer'

const root = document.getElementById('root')
const file = new URLSearchParams(location.search).get('file') ?? ''
const backend = new ExtensionBackend(chrome.runtime)
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HootUIProvider>
        <Viewer file={file} backend={backend} />
      </HootUIProvider>
    </StrictMode>
  )
}
