import type { ChatStreamRequest, AiProvider, JsonRequest } from './types'
import { AiError, AiOutputError } from './errors'

const CHUNK = 12
const INTERVAL_MS = 25

function lastUserText(req: ChatStreamRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]
    if (!m || m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    return m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
  }
  return ''
}

/** Images attached to the last user message: the count the fake reports back. */
function imageCount(req: ChatStreamRequest): number {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]
    if (!m || m.role !== 'user') continue
    if (typeof m.content === 'string') return 0
    return m.content.filter((b) => b.type === 'image').length
  }
  return 0
}

export interface FakeProviderOptions {
  /** Answers generateJson calls; the result is still checked against the schema. */
  json?: (req: JsonRequest<unknown>) => unknown
  chunkMs?: number
}

/**
 * Deterministic provider for `HOOT_FAKE_AI=1` and tests: no key, no network.
 * Chat answers echo the prompt and the number of attached images.
 */
export function createFakeProvider(opts: FakeProviderOptions = {}): AiProvider {
  const chunkMs = opts.chunkMs ?? INTERVAL_MS
  return {
    async stream(req, onText) {
      const text = lastUserText(req).slice(0, 80)
      const full =
        `**Fake Hoot answer.** I got ${imageCount(req)} image(s) and your message: "${text}".\n\n` +
        `- point one\n- point two\n\n` +
        '```js\n' +
        "console.log('hoot')\n" +
        '```\n'
      for (let i = 0; i < full.length; i += CHUNK) {
        if (req.signal.aborted) return { stopReason: 'aborted' }
        onText(full.slice(i, i + CHUNK))
        await new Promise((r) => setTimeout(r, chunkMs))
      }
      return { stopReason: 'STOP' }
    },
    async generateJson<T>(req: JsonRequest<T>): Promise<T> {
      if (!opts.json) throw new AiError('unknown', 'fake provider has no json handler')
      const parsed = req.schema.safeParse(opts.json(req as JsonRequest<unknown>))
      if (!parsed.success) throw new AiOutputError(parsed.error.message)
      return parsed.data
    },
    async validateKey(key) {
      return key.startsWith('AIza')
    }
  }
}
