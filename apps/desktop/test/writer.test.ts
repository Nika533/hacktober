import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedWriter, type DebouncedWriter } from '../src/main/store/writer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const make = (): { writer: DebouncedWriter; errors: [unknown, string][] } => {
  const errors: [unknown, string][] = []
  const writer = createDebouncedWriter({
    delayMs: 300,
    onError: (e, key) => errors.push([e, key])
  })
  return { writer, errors }
}

describe('DebouncedWriter', () => {
  it('runs a scheduled fn after the delay', async () => {
    const { writer } = make()
    const calls: string[] = []
    writer.schedule('k', async () => {
      calls.push('ran')
    })
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    expect(calls).toEqual(['ran'])
  })

  it('coalesces by key — last fn wins', async () => {
    const { writer } = make()
    const calls: string[] = []
    writer.schedule('k', async () => {
      calls.push('first')
    })
    await vi.advanceTimersByTimeAsync(100)
    writer.schedule('k', async () => {
      calls.push('last')
    })
    writer.schedule('other', async () => {
      calls.push('other')
    })
    await vi.advanceTimersByTimeAsync(300)
    expect(calls).toEqual(['last', 'other'])
  })

  it('flush runs pending work immediately and awaits it', async () => {
    const { writer } = make()
    const calls: string[] = []
    let resolveFn: (() => void) | null = null
    writer.schedule(
      'k',
      () =>
        new Promise<void>((r) => {
          resolveFn = () => {
            calls.push('done')
            r()
          }
        })
    )
    let flushed = false
    const flushing = writer.flush().then(() => {
      flushed = true
    })
    // fn started, but flush is still waiting on it.
    await Promise.resolve()
    expect(flushed).toBe(false)
    resolveFn!()
    await flushing
    expect(flushed).toBe(true)
    expect(calls).toEqual(['done'])
    expect(writer.pending()).toBe(0)
  })

  it('a rejected fn goes to onError, never out of the timer', async () => {
    const { writer, errors } = make()
    const boom = new Error('boom')
    writer.schedule('bad', () => Promise.reject(boom))
    writer.schedule('good', () => Promise.resolve())
    await vi.advanceTimersByTimeAsync(1000)
    expect(errors).toEqual([[boom, 'bad']])
  })

  it('flush surfaces rejections through onError too', async () => {
    const { writer, errors } = make()
    const boom = new Error('boom')
    writer.schedule('k', () => Promise.reject(boom))
    await writer.flush()
    expect(errors).toEqual([[boom, 'k']])
  })
})
