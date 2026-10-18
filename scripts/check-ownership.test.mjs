import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { builderOf, findViolations, globToRegExp, isAllowed } from './check-ownership.mjs'

const rules = JSON.parse(readFileSync(new URL('./ownership.json', import.meta.url), 'utf8'))

describe('globToRegExp', () => {
  it('handles **, *, ? and {a,b}', () => {
    expect(globToRegExp('packages/core/**').test('packages/core/src/a/b.ts')).toBe(true)
    expect(globToRegExp('docs/*.md').test('docs/status/c.md')).toBe(false)
    expect(globToRegExp('a/**/b.ts').test('a/b.ts')).toBe(true)
    expect(globToRegExp('e2e/{studio,reader}-*').test('e2e/reader-pdf.spec.ts')).toBe(true)
    expect(globToRegExp('tsconfig.*.json').test('tsconfig.web.json')).toBe(true)
    expect(globToRegExp('tsconfig.*.json').test('tsconfigXwebXjson')).toBe(false)
  })

  it('lets the last matching pattern win', () => {
    const p = ['src/main/**', '!src/main/ai/**']
    expect(isAllowed('src/main/index.ts', p)).toBe(true)
    expect(isAllowed('src/main/ai/gemini.ts', p)).toBe(false)
  })
})

describe('ownership rules', () => {
  const owns = (builder, path) => findViolations(builder, [path], rules).length === 0

  it('maps branch prefixes to builders', () => {
    expect(builderOf('d2/D2-10-inline')).toBe('d2')
    expect(builderOf('c/m0-foundation')).toBe('c')
    expect(builderOf('feature/x')).toBeNull()
    expect(builderOf('d4/x')).toBeNull()
  })

  it('gives each builder its folders and nothing else', () => {
    expect(owns('d1', 'apps/desktop/src/main/windows/buddy.ts')).toBe(true)
    expect(owns('d1', 'apps/desktop/src/main/ai/gemini.ts')).toBe(false)
    expect(owns('d1', 'apps/desktop/src/main/context.ts')).toBe(true)
    expect(owns('d1', 'apps/desktop/src/renderer/buddy/Card.tsx')).toBe(false)
    expect(owns('d1', 'apps/desktop/src/renderer/studio/App.tsx')).toBe(false)
    expect(owns('d1', 'packages/core/src/index.ts')).toBe(false)

    expect(owns('d2', 'packages/lens-dom/src/render/inline.ts')).toBe(true)
    expect(owns('d2', 'apps/extension/src/sw.ts')).toBe(true)
    expect(owns('d2', 'packages/ui/src/index.ts')).toBe(false)

    expect(owns('d3', 'packages/ui/src/tokens.css')).toBe(true)
    expect(owns('d3', 'apps/desktop/src/renderer/reader/App.tsx')).toBe(true)
    expect(owns('d3', 'apps/desktop/e2e/studio-settings.spec.ts')).toBe(true)
    expect(owns('d3', 'apps/desktop/e2e/buddy-modes.spec.ts')).toBe(false)

    expect(owns('c', 'apps/desktop/src/main/lens/engine.ts')).toBe(true)
    expect(owns('c', 'apps/desktop/src/main/windows/buddy.ts')).toBe(false)
  })

  it('follows the finish-plan reassignments (one owner per feature, d1 wires)', () => {
    for (const p of [
      'apps/desktop/src/main/chat/service.ts',
      'apps/desktop/src/main/pins/index.ts',
      'apps/desktop/src/renderer/note/App.tsx',
      'apps/desktop/test/chat/service.test.ts'
    ]) {
      expect(owns('c', p)).toBe(true)
      expect(owns('d1', p)).toBe(false)
    }
    for (const p of [
      'apps/desktop/src/main/capture/index.ts',
      'apps/desktop/src/renderer/capture/App.tsx',
      'apps/desktop/e2e/capture-flow.spec.ts'
    ]) {
      expect(owns('d2', p)).toBe(true)
      expect(owns('d1', p)).toBe(false)
    }
    expect(owns('d3', 'apps/desktop/src/renderer/buddy/App.tsx')).toBe(true)
    expect(owns('d3', 'apps/desktop/e2e/card-stream.spec.ts')).toBe(true)
    expect(owns('d1', 'apps/desktop/e2e/buddy-modes.spec.ts')).toBe(true)
    expect(owns('c', 'apps/desktop/src/main/context.ts')).toBe(false)
    for (const b of ['c', 'd1']) expect(owns(b, 'apps/desktop/electron-builder.yml')).toBe(true)
  })

  it('lets everyone touch the lockfile and only their own status file', () => {
    for (const b of ['c', 'd1', 'd2', 'd3']) {
      expect(owns(b, 'package-lock.json')).toBe(true)
      expect(owns(b, `docs/status/${b}.md`)).toBe(true)
    }
    expect(owns('d2', 'docs/status/d1.md')).toBe(false)
    expect(owns('c', 'docs/status/d3.md')).toBe(false)
    expect(owns('d1', 'docs/rebuild-plan.md')).toBe(false)
  })
})
