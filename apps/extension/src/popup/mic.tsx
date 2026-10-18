/** mic.html: asks for the microphone once, for the popup's voice questions. */
import '@hoot/ui/styles.css'
import './popup.css'
import { HootUIProvider } from '@hoot/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MicSetup } from './MicSetup'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HootUIProvider>
        <MicSetup />
      </HootUIProvider>
    </StrictMode>
  )
}
