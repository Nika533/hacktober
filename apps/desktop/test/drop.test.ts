import { describe, expect, it, vi } from 'vitest'
import { guardContents } from '../src/main/windows/base'
import { fileArgFromArgv, readerPathFromNavigation } from '../src/main/windows/drop'

describe('readerPathFromNavigation', () => {
  it('returns the path for file: URLs with a Reader extension', () => {
    for (const url of [
      'file:///C:/docs/paper.pdf',
      'file:///C:/docs/paper.PDF',
      'file:///C:/docs/page.html',
      'file:///C:/docs/page.htm'
    ]) {
      const path = readerPathFromNavigation(url)
      expect(path, url).not.toBeNull()
      expect(path!.replaceAll('/', '\\')).toMatch(/\.(pdf|html?)$/i)
    }
  })

  it('strips query and hash', () => {
    const path = readerPathFromNavigation('file:///C:/doc.pdf?dl=1#page=2')
    expect(path).not.toBeNull()
    expect(path!.replaceAll('/', '\\')).toBe('C:\\doc.pdf')
  })

  it('decodes percent-encoded and UNC paths', () => {
    expect(readerPathFromNavigation('file:///C:/my%20docs/a.pdf')!.replaceAll('/', '\\')).toBe(
      'C:\\my docs\\a.pdf'
    )
    expect(readerPathFromNavigation('file://server/share/a.pdf')).toBe('\\\\server\\share\\a.pdf')
  })

  it('returns null for non-file URLs and non-Reader extensions', () => {
    expect(readerPathFromNavigation('https://example.com/a.pdf')).toBeNull()
    expect(readerPathFromNavigation('hoot://app/buddy.html')).toBeNull()
    expect(readerPathFromNavigation('file:///C:/app.exe')).toBeNull()
    expect(readerPathFromNavigation('file:///C:/notes.txt')).toBeNull()
    expect(readerPathFromNavigation('not a url')).toBeNull()
  })
})

describe('fileArgFromArgv', () => {
  const exists = (p: string): boolean => p === 'C:\\docs\\a.pdf'

  it('finds the first existing Reader file, skipping argv[0] and flags', () => {
    expect(fileArgFromArgv(['C:\\hoot\\hoot.exe', '--hidden', 'C:\\docs\\a.pdf'], exists)).toBe(
      'C:\\docs\\a.pdf'
    )
  })

  it('accepts a file: URL argument', () => {
    const path = fileArgFromArgv(['hoot.exe', 'file:///C:/docs/a.pdf'], exists)
    expect(path).toBe('C:\\docs\\a.pdf')
  })

  it('returns null for nonexistent files and non-Reader args', () => {
    expect(fileArgFromArgv(['hoot.exe', 'C:\\docs\\a.pdf'], () => false)).toBeNull()
    expect(fileArgFromArgv(['hoot.exe', 'C:\\app\\out\\main\\index.js'], () => true)).toBeNull()
    expect(fileArgFromArgv(['hoot.exe'], exists)).toBeNull()
  })
})

describe('guardContents file drop', () => {
  class FakeContents {
    readonly handlers = new Map<string, (e: { url: string; preventDefault(): void }) => void>()
    readonly prevented: string[] = []
    readonly dropped: string[] = []

    on(event: string, cb: (e: { url: string; preventDefault(): void }) => void): this {
      this.handlers.set(event, cb)
      return this
    }

    setWindowOpenHandler(): void {
      /* denied in the real guard; nothing to record here */
    }

    navigate(url: string): void {
      this.handlers.get('will-navigate')?.({
        url,
        preventDefault: () => this.prevented.push(url)
      })
    }
  }

  const wc = (c: FakeContents): Electron.WebContents => c as unknown as Electron.WebContents

  it('routes a Reader file navigation to onFileDrop instead of navigating', () => {
    const c = new FakeContents()
    const onFileDrop = vi.fn()
    guardContents(wc(c), { onFileDrop })
    c.navigate('file:///C:/docs/a.pdf')
    expect(onFileDrop).toHaveBeenCalledOnce()
    expect(onFileDrop.mock.calls[0]![0].replaceAll('/', '\\')).toBe('C:\\docs\\a.pdf')
    expect(c.prevented).toEqual(['file:///C:/docs/a.pdf'])
  })

  it('applies the handler even when the base guard was installed first', () => {
    const c = new FakeContents()
    guardContents(wc(c)) // web-contents-created beats the factory to it
    const onFileDrop = vi.fn()
    guardContents(wc(c), { onFileDrop })
    c.navigate('file:///C:/docs/a.pdf')
    expect(onFileDrop).toHaveBeenCalledOnce()
  })

  it('prevents other disallowed navigations exactly as before', () => {
    const c = new FakeContents()
    const onFileDrop = vi.fn()
    guardContents(wc(c), { onFileDrop })
    c.navigate('https://example.com')
    c.navigate('file:///C:/app.exe')
    expect(onFileDrop).not.toHaveBeenCalled()
    expect(c.prevented).toEqual(['https://example.com', 'file:///C:/app.exe'])
  })
})
