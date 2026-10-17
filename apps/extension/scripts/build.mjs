/**
 * Builds the unpacked extension into dist/: bundles each entry with esbuild
 * and copies static/ (manifest.json, HTML pages) next to them.
 * `--watch` rebuilds on change.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'dist')
const watch = process.argv.includes('--watch')

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })
cpSync(join(root, 'static'), outdir, { recursive: true })

const common = {
  bundle: true,
  target: 'chrome120',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
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
      options: join(root, 'src/options/index.ts'),
      viewer: join(root, 'src/viewer/index.ts')
    },
    format: 'esm'
  }
]

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch()
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)))
}
