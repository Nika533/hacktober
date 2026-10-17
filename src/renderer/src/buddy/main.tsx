import '../shared/styles/tokens.css'
import '../shared/styles/type.css'
import '../shared/styles/materials.css'
import '../shared/styles/chat.css'
import './buddy.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initReducedMotionAttr } from '../shared/hooks'
import { BuddyApp } from './BuddyApp'

initReducedMotionAttr()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BuddyApp />
  </StrictMode>
)
