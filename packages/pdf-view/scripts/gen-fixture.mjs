/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Writes tests/fixtures/article.pdf: a small two-page article with a title,
// headings, wrapped paragraphs (one hyphenated line break) and a two-line
// heading, using the built-in Helvetica so no font is embedded.
// Usage: node scripts/gen-fixture.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../tests/fixtures/article.pdf')

/** Each page: [fontSize, x, y, text][] in PDF points (origin bottom-left). */
const pages = [
  [
    [24, 72, 720, 'Reading Regression Output'],
    [11, 72, 690, 'A short guide for people who did not take statistics.'],
    [16, 72, 650, 'What the residuals tell you'],
    [11, 72, 625, 'When the spread of the residuals grows with the fitted values,'],
    [11, 72, 611, 'the model shows heteroscedasticity. Ordinary least squares still gives'],
    [11, 72, 597, 'unbiased estimates, but the standard errors are wrong, so the confi-'],
    [11, 72, 583, 'dence intervals and p-values cannot be trusted as printed.'],
    [11, 72, 555, 'A residual plot is the quickest check. Look for a funnel shape rather'],
    [11, 72, 541, 'than an even band around zero.'],
    [16, 72, 505, 'Fixing it'],
    [11, 72, 480, 'Robust standard errors are the usual first step. They change the'],
    [11, 72, 466, 'uncertainty around each coefficient, not the coefficients themselves.']
  ],
  [
    [16, 72, 720, 'When to worry'],
    [11, 72, 695, 'Mild unevenness rarely matters for a large sample. It matters most when'],
    [11, 72, 681, 'decisions depend on whether one effect is significant at 5 percent.'],
    [11, 72, 653, 'Report what you checked and how, so a reader can judge for themselves.']
  ]
]

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

const objects = []
const add = (body) => objects.push(body) // object number = index + 1

add('<< /Type /Catalog /Pages 2 0 R >>')
add('') // Pages, filled in below
add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')

const kids = []
for (const lines of pages) {
  const content = lines
    .map(([size, x, y, text]) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`)
    .join('\n')
  add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  const contentsRef = objects.length
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentsRef} 0 R >>`
  )
  kids.push(`${objects.length} 0 R`)
}
objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`

let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'
const offsets = []
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, 'latin1'))
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xref = Buffer.byteLength(pdf, 'latin1')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(pdf, 'latin1'))
console.log(`wrote ${out} (${pdf.length} bytes)`)
