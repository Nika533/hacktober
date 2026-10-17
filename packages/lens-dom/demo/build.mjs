import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, 'dist')

await mkdir(out, { recursive: true })
await build({
  entryPoints: [resolve(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outfile: resolve(out, 'main.js'),
  logLevel: 'info'
})
const fixture = await readFile(resolve(here, '../tests/fixtures/article.html'), 'utf8')
await writeFile(
  resolve(out, 'index.html'),
  fixture.replace('</body>', '  <script src="./main.js"></script>\n  </body>')
)
