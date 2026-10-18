import { LensBackendError, type BridgeErrorCode } from '@hoot/core'
import type { Reply } from '../messages'
import type { SettingsStore } from './settings'
import type { Upstream } from './upstream'
import { parseContentMessage } from './validate'

export interface Sender {
  id?: string
  url?: string
  tab?: { id?: number }
}

export interface RouterOptions {
  extensionId: string
  upstream: () => Upstream
  settings: SettingsStore
}

export interface Router {
  handle(raw: unknown, sender: Sender): Promise<Reply>
  inflight(): number
}

const fail = (code: BridgeErrorCode, message: string = code): Reply => ({
  ok: false,
  error: { code, message }
})

const ok = <T>(value: T): Reply<T> => ({ ok: true, value })

export function createRouter(options: RouterOptions): Router {
  const inflight = new Map<string, AbortController>()
  const slot = (sender: Sender, reqId: string): string => `${sender.tab?.id ?? 'x'}:${reqId}`

  async function track<T>(
    sender: Sender,
    reqId: string,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<Reply> {
    const key = slot(sender, reqId)
    inflight.get(key)?.abort()
    const controller = new AbortController()
    inflight.set(key, controller)
    try {
      return ok(await run(controller.signal))
    } finally {
      if (inflight.get(key) === controller) inflight.delete(key)
    }
  }

  const ownPage = (sender: Sender): boolean =>
    !!sender.url?.startsWith(`chrome-extension://${options.extensionId}/`)

  async function handle(raw: unknown, sender: Sender): Promise<Reply> {
    if (sender.id !== options.extensionId || (sender.tab?.id === undefined && !ownPage(sender))) {
      return fail('unauthorized')
    }
    const message = parseContentMessage(raw)
    if (!message) return fail('bad_request')
    try {
      const upstream = options.upstream()
      switch (message.type) {
        case 'lens.settings.get':
          return ok(await options.settings.get())
        case 'lens.settings.patch':
          return ok(await options.settings.patch(message.patch))
        case 'lens.profile.get':
          return ok(await upstream.getProfile())
        case 'lens.rewrite': {
          const settings = await options.settings.get()
          if (!settings.enabled) return ok({ kind: 'skipped', reason: 'lens_off' })
          return await track(sender, message.reqId, (signal) =>
            upstream.rewrite(message.request, { signal })
          )
        }
        case 'lens.assess':
          return await track(sender, message.reqId, (signal) =>
            upstream.assess(message.ctx, { signal })
          )
        case 'lens.cancel':
          inflight.get(slot(sender, message.reqId))?.abort()
          return ok(null)
        case 'lens.feedback':
          await upstream.feedback(message.event)
          return ok(null)
        case 'lens.explain':
          await upstream.explainMore(message.ctx)
          return ok(null)
      }
    } catch (error) {
      if (error instanceof LensBackendError) return fail(error.code, error.message)
      return fail('internal', error instanceof Error ? error.message : String(error))
    }
  }

  return { handle, inflight: () => inflight.size }
}
