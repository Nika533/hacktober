import { createRoot } from 'react-dom/client'
import { Diagnostics } from './Diagnostics'

const container = document.getElementById('root')
if (container) createRoot(container).render(<Diagnostics />)
