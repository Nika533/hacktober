import type { AiClient, StreamRequest } from './client'

const CHUNK = 12
const INTERVAL_MS = 25

function lastUserText(req: StreamRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
    return text
  }
  return ''
}

/** Images attached to the last user message — the count Hoot just received. */
function imageCount(req: StreamRequest): number {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i]
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return 0
    return m.content.filter((b) => b.type === 'image').length
  }
  return 0
}

export function createFakeClient(): AiClient {
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
        await new Promise((r) => setTimeout(r, INTERVAL_MS))
      }
      return { stopReason: 'end_turn' }
    },
    async validateKey(key) {
      return key.startsWith('AIza')
    }
  }
}
