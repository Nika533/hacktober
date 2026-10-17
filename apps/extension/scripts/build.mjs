import { build } from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dev = process.argv.includes('--dev')
const outdir = resolve(root, dev ? 'dist/dev' : 'dist/prod')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const shared = {
  bundle: true,
  target: 'chrome120',
  legalComments: 'none',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  define: { __HOOT_DEV__: String(dev) },
  alias: { '@hoot/lens-dom': resolve(root, '../../packages/lens-dom/src/index.ts') },
  logLevel: 'info'
}

await build({
  ...shared,
  entryPoints: { content: resolve(root, 'src/content/index.ts') },
  format: 'iife',
  outdir
})
await build({
  ...shared,
  entryPoints: { sw: resolve(root, 'src/sw/index.ts') },
  format: 'esm',
  outdir
})

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
manifest.version = pkg.version === '0.0.0' ? '0.1.0' : pkg.version
if (dev) manifest.name = `${manifest.name} (dev)`
await writeFile(resolve(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Built ${dev ? 'dev' : 'production'} extension in ${outdir}`)
