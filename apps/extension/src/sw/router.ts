import type { LensSettingsView } from '@hoot/lens-dom'
import { parseContentMessage, type Reply } from '../messages'
import { UpstreamError, type Upstream } from './upstream'

export interface SettingsStore {
  get(): Promise<LensSettingsView>
}

export interface SiteStore {
  isPaused(site: string): Promise<boolean>
  setPaused(site: string, paused: boolean): Promise<void>
}

export interface Sender {
  id?: string
  tab?: { id?: number }
}

export interface RouterOptions {
  extensionId: string
  upstream: () => Upstream
  settings: SettingsStore
  sites: SiteStore
}

const fail = (code: string, message = code): Reply => ({ ok: false, error: { code, message } })
const ok = <T>(value: T): Reply<T> => ({ ok: true, value })

export function createRouter(options: RouterOptions): {
  handle(raw: unknown, sender: Sender): Promise<Reply>
  inflight(): number
} {
  const inflight = new Map<string, AbortController>()

  const key = (sender: Sender, reqId: string): string => `${sender.tab?.id ?? 'x'}:${reqId}`

  async function track<T>(
    sender: Sender,
    reqId: string,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<Reply> {
    const slot = key(sender, reqId)
    inflight.get(slot)?.abort()
    const controller = new AbortController()
    inflight.set(slot, controller)
    try {
      return ok(await run(controller.signal))
    } finally {
      if (inflight.get(slot) === controller) inflight.delete(slot)
    }
  }

  async function handle(raw: unknown, sender: Sender): Promise<Reply> {
    if (sender.id !== options.extensionId || sender.tab?.id === undefined) {
      return fail('forbidden')
    }
    const message = parseContentMessage(raw)
    if (!message) return fail('invalid-message')
    try {
      const upstream = options.upstream()
      switch (message.type) {
        case 'lens.settings.get':
          return ok(await options.settings.get())
        case 'lens.rewrite': {
          const settings = await options.settings.get()
          if (!settings.enabled || settings.mode === 'off') return fail('lens-off')
          return await track(sender, message.reqId, (signal) =>
            upstream.rewrite(message.reqId, message.request, signal)
          )
        }
        case 'lens.assess':
          return await track(sender, message.reqId, (signal) =>
            upstream.assess(message.reqId, message.context, signal)
          )
        case 'lens.cancel':
          inflight.get(key(sender, message.reqId))?.abort()
          return ok(null)
        case 'lens.feedback':
          await upstream.feedback(message.event)
          return ok(null)
        case 'lens.profile.get':
          return ok(await upstream.profile())
        case 'lens.explain':
          await upstream.explain(message.request)
          return ok(null)
        case 'lens.site.get':
          return ok({ paused: await options.sites.isPaused(message.site) })
        case 'lens.site.pause':
          await options.sites.setPaused(message.site, message.paused)
          return ok(null)
      }
    } catch (error) {
      if (error instanceof UpstreamError) return fail(error.code, error.message)
      return fail('internal', error instanceof Error ? error.message : String(error))
    }
  }

  return { handle, inflight: () => inflight.size }
}
