/**
 * Bundles the extension into dist/extension.js (CommonJS for the VS Code
 * extension host), with @hoot/core and zod inlined; only `vscode` stays external.
 */
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

rmSync(join(root, 'dist'), { recursive: true, force: true })
await esbuild.build({
  entryPoints: [join(root, 'src/extension.ts')],
  outfile: join(root, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info'
})
