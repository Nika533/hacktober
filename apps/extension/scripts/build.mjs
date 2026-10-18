/**
 * Builds the unpacked extension into dist/: bundles each entry with esbuild
 * and copies static/ (manifest.json, HTML pages) next to them.
 * `--watch` rebuilds on change.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'dist')
const watch = process.argv.includes('--watch')
const modeIndex = process.argv.indexOf('--mode')
const e2e = modeIndex >= 0 && process.argv[modeIndex + 1] === 'e2e'
const fromPdfView = createRequire(createRequire(import.meta.url).resolve('@hoot/pdf-view'))
const pdfjs = dirname(fromPdfView.resolve('pdfjs-dist/package.json'))

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })
cpSync(join(root, 'static'), outdir, { recursive: true })
cpSync(join(pdfjs, 'build/pdf.worker.min.mjs'), join(outdir, 'pdfjs/pdf.worker.min.mjs'))
cpSync(join(pdfjs, 'standard_fonts'), join(outdir, 'pdfjs/standard_fonts'), { recursive: true })
cpSync(join(pdfjs, 'cmaps'), join(outdir, 'pdfjs/cmaps'), { recursive: true })

if (e2e) {
  const manifestPath = join(outdir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.name = `${manifest.name} (e2e)`
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

const common = {
  bundle: true,
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  jsx: 'automatic',
  define: { __HOOT_E2E__: String(e2e) },
  logLevel: 'info',
  outdir
}

const builds = [
  // Content scripts can't be modules: one self-contained IIFE.
  { ...common, entryPoints: { content: join(root, 'src/content/index.ts') }, format: 'iife' },
  {
    ...common,
    entryPoints: {
      sw: join(root, 'src/sw.ts'),
      options: join(root, 'src/options/index.tsx'),
      viewer: join(root, 'src/viewer/index.tsx'),
      popup: join(root, 'src/popup/index.tsx'),
      mic: join(root, 'src/popup/mic.tsx')
    },
    format: 'esm'
  }
]

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch()
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)))
}
