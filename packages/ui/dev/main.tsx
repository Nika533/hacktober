import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HootUIProvider, applyAccent, applyTheme, type ThemePreference } from '../src'
import { Gallery } from '../src/gallery'
import '../src/styles.css'

// Stand-alone harness for the gallery: #/gallery?theme=dark&accent=ca5010
if (!location.hash.startsWith('#/gallery')) location.hash = '#/gallery'
const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
const theme = (
  ['light', 'dark'].includes(params.get('theme') ?? '') ? params.get('theme') : 'system'
) as ThemePreference
const accent = params.get('accent') ?? 'default'
applyTheme(theme)
applyAccent(accent === 'default' ? null : accent)

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    <HootUIProvider>
      <Gallery initialTheme={theme} initialAccent={accent} />
    </HootUIProvider>
  </StrictMode>
)
