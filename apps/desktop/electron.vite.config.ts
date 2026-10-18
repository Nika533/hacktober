import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Workspace packages ship TypeScript source, so they are bundled, never
// externalized like the runtime dependencies in package.json.
const WORKSPACE = ['@hoot/core', '@hoot/bridge', '@hoot/ui', '@hoot/lens-dom', '@hoot/pdf-view']

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: WORKSPACE } }
  },
  preload: {
    build: { externalizeDeps: { exclude: WORKSPACE } }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          buddy: resolve('src/renderer/buddy.html'),
          studio: resolve('src/renderer/studio.html'),
          capture: resolve('src/renderer/capture.html'),
          note: resolve('src/renderer/note.html'),
          reader: resolve('src/renderer/reader.html')
        }
      }
    }
  }
})
