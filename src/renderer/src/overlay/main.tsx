import '../shared/styles/tokens.css'
import '../shared/styles/type.css'
import '../shared/styles/materials.css'
import './overlay.css'

import { createRoot } from 'react-dom/client'
import { initReducedMotionAttr } from '../shared/hooks'
import { OverlayApp } from './OverlayApp'

initReducedMotionAttr()

createRoot(document.getElementById('root')!).render(<OverlayApp />)
