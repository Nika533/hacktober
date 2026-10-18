import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { z } from 'zod'
import type { HootApi } from '../src/ipc/api'
import {
  HOOT_API_ROUTES,
  createHootApi,
  type ApiFn,
  type EventPayload,
  type InvokeChannel,
  type InvokeResult,
  type Route
} from '../src/ipc/routes'
import {
  INVOKE_ARGS,
  IpcValidationError,
  SEND_ARGS,
  parseInvokeArgs,
  parseSendArgs
} from '../src/ipc/schemas'
import type { ChatDelta } from '../src/types/chat'
import type { StatePatch } from '../src/types/state'
import { sampleContext } from './fixtures'

const allRoutes = Object.values(HOOT_API_ROUTES).flatMap((group) => Object.values(group) as Route[])

describe('route table', () => {
  it('uses each channel once', () => {
    const channels = allRoutes.map((r) => r.channel)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('has an argument schema for every invoke and send channel, and nothing else', () => {
    const invoke = allRoutes.filter((r) => r.kind === 'invoke').map((r) => r.channel)
    const send = allRoutes.filter((r) => r.kind === 'send').map((r) => r.channel)
    expect(Object.keys(INVOKE_ARGS).sort()).toEqual([...invoke].sort())
    expect(Object.keys(SEND_ARGS).sort()).toEqual([...send].sort())
  })
})

describe('createHootApi', () => {
  it('maps methods onto invoke, send and event channels', async () => {
    const invoke = vi.fn(async () => 'ok')
    const send = vi.fn()
    const off = vi.fn()
    const on = vi.fn(() => off)
    const api = createHootApi({ invoke, send, on })

    await expect(api.sessions.rename('s1', 'Title')).resolves.toBe('ok')
    expect(invoke).toHaveBeenCalledWith('sessions:rename', 's1', 'Title')

    api.buddy.dragEnd({ vx: 1, vy: 2 })
    expect(send).toHaveBeenCalledWith('buddy:dragEnd', { vx: 1, vy: 2 })

    const cb = (): void => {}
    expect(api.chat.onDelta(cb)).toBe(off)
    expect(on).toHaveBeenCalledWith('chat:delta', cb)
  })
})

describe('argument validation', () => {
  it('accepts well-formed calls', () => {
    expect(parseInvokeArgs('sessions:rename', ['abc-123', ' Trip notes '])).toEqual([
      'abc-123',
      'Trip notes'
    ])
    expect(parseInvokeArgs('capture:start', [])).toEqual([])
    expect(parseInvokeArgs('lens:assess', ['r1', sampleContext()])).toHaveLength(2)
    expect(parseSendArgs('buddy:requestMode', ['card'])).toEqual(['card'])
    expect(parseInvokeArgs('settings:suspendHotkeys', [true])).toEqual([true])
    const rect = { x: 0, y: 0, width: 40, height: 40 }
    expect(parseSendArgs('buddy:hitRegions', [[rect]])).toEqual([[rect]])
  })

  it('rejects path traversal, unknown quick actions, bad URLs and extra args', () => {
    const bad: [InvokeChannel, unknown[]][] = [
      ['sessions:open', ['../../secrets']],
      ['chat:send', [{ quickAction: 'format-disk' }]],
      ['chat:send', [{ text: '   ' }]],
      ['app:openExternal', ['file:///C:/Windows/System32']],
      ['app:openExternal', ['javascript:alert(1)']],
      ['settings:update', [{ onboardingDone: true }]],
      ['chat:stop', ['unexpected']],
      ['state:subscribe', [['everything']]]
    ]
    for (const [channel, args] of bad) {
      expect(() => parseInvokeArgs(channel, args), channel).toThrow(IpcValidationError)
    }
    expect(() => parseSendArgs('buddy:requestMode', ['fullscreen'])).toThrow(IpcValidationError)
  })
})

describe('types', () => {
  it('keeps argument schemas in step with HootApi parameters', () => {
    expectTypeOf<z.input<(typeof INVOKE_ARGS)['sessions:rename']>>().toEqualTypeOf<
      Parameters<HootApi['sessions']['rename']>
    >()
    expectTypeOf<z.output<(typeof INVOKE_ARGS)['lens:rewrite']>>().toExtend<
      Parameters<HootApi['lens']['rewrite']>
    >()
    expectTypeOf<z.output<(typeof SEND_ARGS)['buddy:dragEnd']>>().toEqualTypeOf<
      Parameters<HootApi['buddy']['dragEnd']>
    >()
  })

  it('derives handler and event types from the routes', () => {
    expectTypeOf<ApiFn<'chat:send'>>().toEqualTypeOf<HootApi['chat']['send']>()
    expectTypeOf<InvokeResult<'sessions:search'>>().toEqualTypeOf<
      Awaited<ReturnType<HootApi['sessions']['search']>>
    >()
    expectTypeOf<EventPayload<'chat:delta'>>().toEqualTypeOf<ChatDelta>()
    expectTypeOf<EventPayload<'state:patch'>>().toEqualTypeOf<StatePatch>()
    expectTypeOf<EventPayload<'capture:open'>>().toEqualTypeOf<undefined>()
  })
})
