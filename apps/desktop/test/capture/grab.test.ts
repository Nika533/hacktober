import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSources = vi.fn<(options: { thumbnailSize: { width: number } }) => Promise<unknown[]>>(
  async () => [{ id: 'screen:1', display_id: '1', thumbnail: thumbnail() }]
)

function thumbnail(): unknown {
  return {
    getSize: () => ({ width: 3000, height: 2000 }),
    isEmpty: () => false
  }
}

vi.mock('electron', () => ({
  desktopCapturer: {
    getSources: (options: { thumbnailSize: { width: number } }) => getSources(options)
  },
  nativeImage: {},
  screen: {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1500, height: 1000 },
      size: { width: 1500, height: 1000 },
      scaleFactor: 2
    })
  }
}))

const { createScreenGrabber } = await import('../../src/main/capture/grab')

const noop = (): void => undefined
const log = { info: noop, warn: noop, error: noop }

beforeEach(() => {
  vi.useFakeTimers()
  getSources.mockClear()
})

afterEach(() => vi.useRealTimers())

describe('screen grabber warm-up', () => {
  it('waits for the app to settle, then warms once', async () => {
    const grabber = createScreenGrabber(log, { warm: true, warmDelayMs: 1000 })
    grabber.prewarm()
    grabber.prewarm()
    await vi.advanceTimersByTimeAsync(999)
    expect(getSources).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(getSources).toHaveBeenCalledOnce()
    expect(getSources.mock.calls[0]![0].thumbnailSize.width).toBe(16)
    grabber.prewarm()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getSources).toHaveBeenCalledOnce()
  })

  it('skips the warm-up after a real capture, in tests and with the fake grabber', async () => {
    const used = createScreenGrabber(log, { warm: true, warmDelayMs: 1000 })
    used.prewarm()
    await used.grab()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getSources).toHaveBeenCalledOnce()
    expect(getSources.mock.calls[0]![0].thumbnailSize.width).toBe(3000)

    getSources.mockClear()
    createScreenGrabber(log, { warm: false, warmDelayMs: 10 }).prewarm()
    createScreenGrabber(log, { fakePath: 'x.png', warm: true, warmDelayMs: 10 }).prewarm()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getSources).not.toHaveBeenCalled()
  })
})
