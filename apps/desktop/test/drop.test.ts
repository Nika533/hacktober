import { describe, expect, it, vi } from 'vitest'
import { guardContents } from '../src/main/windows/base'
import { fileArgFromArgv, readerPathFromNavigation } from '../src/main/windows/drop'

// Hoot is Windows-first, so the path cases use Windows semantics explicitly
// (`windows: true`) and run the same on every CI runner.
const WIN = true
const onWindows = process.platform === 'win32'

describe('readerPathFromNavigation', () => {
  it('returns the path for file: URLs with a Reader extension', () => {
    for (const url of [
      'file:///C:/docs/paper.pdf',
      'file:///C:/docs/paper.PDF',
      'file:///C:/docs/page.html',
      'file:///C:/docs/page.htm'
    ]) {
      const path = readerPathFromNavigation(url, WIN)
      expect(path, url).not.toBeNull()
      expect(path!).toMatch(/^C:\\docs\\.+\.(pdf|html?)$/i)
    }
  })

  it('strips query and hash', () => {
    expect(readerPathFromNavigation('file:///C:/doc.pdf?dl=1#page=2', WIN)).toBe('C:\\doc.pdf')
  })

  it('decodes percent-encoded and UNC paths', () => {
    expect(readerPathFromNavigation('file:///C:/my%20docs/a.pdf', WIN)).toBe('C:\\my docs\\a.pdf')
    expect(readerPathFromNavigation('file://server/share/a.pdf', WIN)).toBe(
      '\\\\server\\share\\a.pdf'
    )
  })

  it('uses POSIX paths when not on Windows semantics', () => {
    expect(readerPathFromNavigation('file:///home/me/my%20docs/a.pdf', false)).toBe(
      '/home/me/my docs/a.pdf'
    )
  })

  it('defaults to the host platform', () => {
    const path = readerPathFromNavigation(
      onWindows ? 'file:///C:/docs/a.pdf' : 'file:///tmp/docs/a.pdf'
    )
    expect(path).toBe(onWindows ? 'C:\\docs\\a.pdf' : '/tmp/docs/a.pdf')
  })

  it('returns null for non-file URLs and non-Reader extensions', () => {
    expect(readerPathFromNavigation('https://example.com/a.pdf', WIN)).toBeNull()
    expect(readerPathFromNavigation('hoot://app/buddy.html', WIN)).toBeNull()
    expect(readerPathFromNavigation('file:///C:/app.exe', WIN)).toBeNull()
    expect(readerPathFromNavigation('file:///C:/notes.txt', WIN)).toBeNull()
    expect(readerPathFromNavigation('not a url', WIN)).toBeNull()
  })
})

describe('fileArgFromArgv', () => {
  const exists = (p: string): boolean => p === 'C:\\docs\\a.pdf'

  it('finds the first existing Reader file, skipping argv[0] and flags', () => {
    expect(
      fileArgFromArgv(['C:\\hoot\\hoot.exe', '--hidden', 'C:\\docs\\a.pdf'], exists, WIN)
    ).toBe('C:\\docs\\a.pdf')
  })

  it('accepts a file: URL argument', () => {
    expect(fileArgFromArgv(['hoot.exe', 'file:///C:/docs/a.pdf'], exists, WIN)).toBe(
      'C:\\docs\\a.pdf'
    )
  })

  it('returns null for nonexistent files and non-Reader args', () => {
    expect(fileArgFromArgv(['hoot.exe', 'C:\\docs\\a.pdf'], () => false, WIN)).toBeNull()
    expect(
      fileArgFromArgv(['hoot.exe', 'C:\\app\\out\\main\\index.js'], () => true, WIN)
    ).toBeNull()
    expect(fileArgFromArgv(['hoot.exe'], exists, WIN)).toBeNull()
  })
})

describe('guardContents file drop', () => {
  class FakeContents {
    readonly handlers = new Map<string, (e: { url: string; preventDefault(): void }) => void>()
    readonly prevented: string[] = []

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
  // The guard parses with the host platform's rules; pick a URL that is a
  // valid absolute file path on the runner.
  const docUrl = onWindows ? 'file:///C:/docs/a.pdf' : 'file:///tmp/docs/a.pdf'
  const docPath = onWindows ? 'C:\\docs\\a.pdf' : '/tmp/docs/a.pdf'

  it('routes a Reader file navigation to onFileDrop instead of navigating', () => {
    const c = new FakeContents()
    const onFileDrop = vi.fn()
    guardContents(wc(c), { onFileDrop })
    c.navigate(docUrl)
    expect(onFileDrop).toHaveBeenCalledExactlyOnceWith(docPath)
    expect(c.prevented).toEqual([docUrl])
  })

  it('applies the handler even when the base guard was installed first', () => {
    const c = new FakeContents()
    guardContents(wc(c)) // web-contents-created beats the factory to it
    const onFileDrop = vi.fn()
    guardContents(wc(c), { onFileDrop })
    c.navigate(docUrl)
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
