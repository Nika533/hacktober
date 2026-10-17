/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Generates e2e/fixtures/screen.png — a fake "desktop" for HOOT_FAKE_CAPTURE.
// Recognizable content: sky gradient, a white window with a title bar,
// a red circle, a green triangle, and blocky HOOT / 123 text.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'

const W = 2560
const H = 1440
const png = new PNG({ width: W, height: H })
const d = png.data

function px(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  d[i] = r
  d[i + 1] = g
  d[i + 2] = b
  d[i + 3] = a
}

function rect(x, y, w, h, r, g, b) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(xx, yy, r, g, b)
}

function circle(cx, cy, rad, r, g, b) {
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) px(cx + x, cy + y, r, g, b)
}

function triangle(x, y, size, r, g, b) {
  for (let yy = 0; yy < size; yy++) {
    const half = Math.round((yy / size) * (size / 2))
    for (let xx = -half; xx <= half; xx++) px(x + xx, y + yy, r, g, b)
  }
}

// sky-ish desktop gradient
for (let y = 0; y < H; y++) {
  const t = y / H
  const r = Math.round(70 + 40 * t)
  const g = Math.round(110 + 30 * t)
  const b = Math.round(180 - 40 * t)
  for (let x = 0; x < W; x++) px(x, y, r, g, b)
}

// a white "app window" with a title bar
rect(700, 260, 1160, 720, 245, 246, 248)
rect(700, 260, 1160, 56, 60, 63, 66)
rect(700, 316, 1160, 2, 200, 200, 205)
// traffic dots
circle(730, 288, 9, 255, 95, 86)
circle(756, 288, 9, 255, 189, 46)
circle(782, 288, 9, 39, 201, 63)

// red circle + green triangle + blue bar
circle(1100, 600, 140, 230, 60, 60)
triangle(1400, 500, 260, 60, 180, 90)
rect(980, 820, 640, 60, 80, 140, 235)

// blocky "HOOT" at 9px cells
const FONT = {
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  1: ['..X..', '.XX..', '..X..', '..X..', '..X..', '..X..', '.XXX.'],
  2: ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  3: ['XXXXX', '....X', '...X.', '..XX.', '....X', 'X...X', '.XXX.']
}
function text(str, x, y, cell, r, g, b) {
  let cx = x
  for (const ch of str) {
    const glyph = FONT[ch]
    if (glyph) {
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) {
          if (row[gx] === 'X') rect(cx + gx * cell, y + gy * cell, cell, cell, r, g, b)
        }
      })
    }
    cx += 6 * cell
  }
}
text('HOOT', 900, 380, 22, 30, 30, 34)
text('123', 1900, 1180, 30, 255, 255, 255)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures', 'screen.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, PNG.sync.write(png))
console.log('wrote', out, `${W}x${H}`)
