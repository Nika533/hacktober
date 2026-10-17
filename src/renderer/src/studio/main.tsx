import '../shared/styles/tokens.css'
import '../shared/styles/type.css'
import '../shared/styles/materials.css'
import '../shared/styles/chat.css'
import './studio.css'

import { createRoot } from 'react-dom/client'
import { initReducedMotionAttr } from '../shared/hooks'
import { StudioApp } from './StudioApp'

initReducedMotionAttr()

createRoot(document.getElementById('root')!).render(<StudioApp />)
