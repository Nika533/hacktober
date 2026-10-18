import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Workspace packages ship TypeScript source, so they are bundled, never
// externalized like the runtime dependencies in package.json.
const WORKSPACE = ['@hoot/core', '@hoot/bridge', '@hoot/ui', '@hoot/lens-dom', '@hoot/pdf-view']

// CSP arrives as a response header (main/windows/csp.ts), so the <meta> CSPs
// baked into the html entry points would only tighten it further: they block
// the Vite dev preamble/styles and prod blob: workers (Reader). Strip them.
function stripMetaCsp(): Plugin {
  return {
    name: 'hoot:strip-meta-csp',
    transformIndexHtml(html) {
      return html.replace(/<meta\s[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>\s*/gi, '')
    }
  }
}

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: WORKSPACE } }
  },
  preload: {
    build: { externalizeDeps: { exclude: WORKSPACE } }
  },
  renderer: {
    plugins: [react(), stripMetaCsp()],
    build: {
      rollupOptions: {
        input: {
          buddy: resolve('src/renderer/buddy.html'),
          studio: resolve('src/renderer/studio.html'),
          capture: resolve('src/renderer/capture.html'),
          note: resolve('src/renderer/note.html'),
          reader: resolve('src/renderer/reader.html'),
          anywhere: resolve('src/renderer/anywhere.html')
        }
      }
    }
  }
})
