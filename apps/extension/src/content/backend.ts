import {
  LensError,
  type AssessResult,
  type ExplainRequest,
  type LensBackend,
  type LensContext,
  type LensFeedback,
  type LensSettingsView,
  type ProfileView,
  type RewriteRequest,
  type RewriteResult
} from '@hoot/lens-dom'
import { parsePush, parseSettings, type ContentMessage, type Reply } from '../messages'

export interface RuntimeLike {
  readonly id?: string
  sendMessage(message: unknown): Promise<unknown>
  onMessage: {
    addListener(listener: (message: unknown) => void): void
    removeListener(listener: (message: unknown) => void): void
  }
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && typeof (value as Reply).ok === 'boolean'
}

export class ExtensionBackend implements LensBackend {
  readonly #runtime: RuntimeLike
  readonly #listeners = new Set<(settings: LensSettingsView) => void>()

  constructor(runtime: RuntimeLike) {
    this.#runtime = runtime
    runtime.onMessage.addListener(this.#onPush)
  }

  async rewrite(reqId: string, request: RewriteRequest): Promise<RewriteResult> {
    return this.#send<RewriteResult>({ type: 'lens.rewrite', reqId, request })
  }

  async assess(reqId: string, context: LensContext): Promise<AssessResult> {
    return this.#send<AssessResult>({ type: 'lens.assess', reqId, context })
  }

  cancel(reqId: string): void {
    void this.#send({ type: 'lens.cancel', reqId }).catch(() => undefined)
  }

  feedback(event: LensFeedback): void {
    void this.#send({ type: 'lens.feedback', event }).catch(() => undefined)
  }

  getProfile(): Promise<ProfileView> {
    return this.#send<ProfileView>({ type: 'lens.profile.get' })
  }

  async getSettings(): Promise<LensSettingsView> {
    const settings = parseSettings(await this.#send({ type: 'lens.settings.get' }))
    if (!settings) throw new LensError('invalid-settings')
    return settings
  }

  onSettings(listener: (settings: LensSettingsView) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  explainMore(request: ExplainRequest): void {
    void this.#send({ type: 'lens.explain', request }).catch(() => undefined)
  }

  async sitePaused(site: string): Promise<boolean> {
    const value = await this.#send<{ paused: boolean }>({ type: 'lens.site.get', site })
    return value.paused === true
  }

  setSitePaused(site: string, paused: boolean): Promise<unknown> {
    return this.#send({ type: 'lens.site.pause', site, paused })
  }

  destroy(): void {
    this.#listeners.clear()
    try {
      this.#runtime.onMessage.removeListener(this.#onPush)
    } catch {
      return
    }
  }

  async #send<T>(message: ContentMessage): Promise<T> {
    if (!this.#runtime.id) throw new LensError('extension-reloaded')
    let reply: unknown
    try {
      reply = await this.#runtime.sendMessage(message)
    } catch (error) {
      if (!this.#runtime.id) throw new LensError('extension-reloaded')
      throw new LensError('no-connection', error instanceof Error ? error.message : String(error))
    }
    if (!isReply(reply)) throw new LensError('no-response')
    if (!reply.ok) throw new LensError(reply.error.code, reply.error.message)
    return reply.value as T
  }

  #onPush = (raw: unknown): void => {
    const push = parsePush(raw)
    if (!push) return
    for (const listener of this.#listeners) listener(push.settings)
  }
}
