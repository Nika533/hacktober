import {
  LensBackendError,
  type AssessResult,
  type LensBackend,
  type LensCallOptions,
  type LensContext,
  type LensEvent,
  type LensSettings,
  type LensSettingsPatch,
  type ProfileSnapshot,
  type RewriteOutcome,
  type RewriteRequest,
  type Unsubscribe
} from '@hoot/core'
import { isPush, isReply, type ContentMessage, type ReplyValues } from '../messages'

export interface RuntimeLike {
  readonly id?: string
  sendMessage(message: unknown): Promise<unknown>
  onMessage: {
    addListener(listener: (message: unknown) => void): void
    removeListener(listener: (message: unknown) => void): void
  }
}

export class ExtensionBackend implements LensBackend {
  readonly #runtime: RuntimeLike
  readonly #settings = new Set<(lens: LensSettings) => void>()
  readonly #profile = new Set<(profile: ProfileSnapshot) => void>()
  #seq = 0

  constructor(runtime: RuntimeLike) {
    this.#runtime = runtime
    runtime.onMessage.addListener(this.#onPush)
  }

  get connected(): boolean {
    return !!this.#runtime.id
  }

  assess(ctx: LensContext, opts?: LensCallOptions): Promise<AssessResult> {
    const reqId = this.#reqId()
    return this.#cancellable(reqId, opts, () => this.#send({ type: 'lens.assess', reqId, ctx }))
  }

  rewrite(request: RewriteRequest, opts?: LensCallOptions): Promise<RewriteOutcome> {
    const reqId = this.#reqId()
    return this.#cancellable(reqId, opts, () =>
      this.#send({ type: 'lens.rewrite', reqId, request })
    )
  }

  async feedback(event: LensEvent): Promise<void> {
    await this.#send({ type: 'lens.feedback', event })
  }

  async explainMore(ctx: LensContext): Promise<void> {
    await this.#send({ type: 'lens.explain', ctx })
  }

  getProfile(): Promise<ProfileSnapshot> {
    return this.#send({ type: 'lens.profile.get' })
  }

  getSettings(): Promise<LensSettings> {
    return this.#send({ type: 'lens.settings.get' })
  }

  patchSettings(patch: LensSettingsPatch): Promise<LensSettings> {
    return this.#send({ type: 'lens.settings.patch', patch })
  }

  onSettings(cb: (lens: LensSettings) => void): Unsubscribe {
    this.#settings.add(cb)
    return () => this.#settings.delete(cb)
  }

  onProfile(cb: (profile: ProfileSnapshot) => void): Unsubscribe {
    this.#profile.add(cb)
    return () => this.#profile.delete(cb)
  }

  destroy(): void {
    this.#settings.clear()
    this.#profile.clear()
    try {
      this.#runtime.onMessage.removeListener(this.#onPush)
    } catch {
      return
    }
  }

  #reqId(): string {
    return `c${Date.now().toString(36)}${(++this.#seq).toString(36)}`
  }

  async #cancellable<T>(
    reqId: string,
    opts: LensCallOptions | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    const signal = opts?.signal
    const cancel = (): void =>
      void this.#send({ type: 'lens.cancel', reqId }).catch(() => undefined)
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      return await run()
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  async #send<K extends ContentMessage['type']>(
    message: Extract<ContentMessage, { type: K }>
  ): Promise<ReplyValues[K]> {
    if (!this.connected) {
      throw new LensBackendError('app_unavailable', 'extension context invalidated')
    }
    let reply: unknown
    try {
      reply = await this.#runtime.sendMessage(message)
    } catch (error) {
      const reason = this.connected ? 'network' : 'app_unavailable'
      throw new LensBackendError(reason, error instanceof Error ? error.message : String(error))
    }
    if (!isReply(reply)) throw new LensBackendError('internal', 'no reply from the service worker')
    if (!reply.ok) throw new LensBackendError(reply.error.code, reply.error.message)
    return reply.value as ReplyValues[K]
  }

  #onPush = (raw: unknown): void => {
    if (!isPush(raw)) return
    if (raw.type === 'lens.settings.changed') for (const cb of this.#settings) cb(raw.lens)
    else for (const cb of this.#profile) cb(raw.profile)
  }
}
