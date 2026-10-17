/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Rasterizes resources/owl.svg → tray.png (16), tray@2x.png (32),
// icon.png (512), icon.ico (16–256). Run: npm.cmd run icons
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'resources/owl.svg'))

const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

const sizes = [
  ['tray.png', 16],
  ['tray@2x.png', 32],
  ['icon.png', 512]
]

for (const [name, size] of sizes) {
  writeFileSync(join(root, 'resources', name), Buffer.from(render(size)))
  console.log(`wrote resources/${name} (${size})`)
}

const icoSizes = [16, 32, 48, 64, 128, 256]
const bufs = icoSizes.map((s) => Buffer.from(render(s)))
writeFileSync(join(root, 'resources', 'icon.ico'), await pngToIco(bufs))
console.log(`wrote resources/icon.ico (${icoSizes.join(', ')})`)
