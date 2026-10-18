import type { VoiceService } from './service'

/** Handlers for the `voice:*` channels: `registerHandlerMap(createVoiceHandlers(ctx.voice))`. */
export function createVoiceHandlers(voice: VoiceService): {
  'voice:start': () => Promise<void>
  'voice:finish': () => Promise<void>
  'voice:stop': () => Promise<void>
  'voice:speak': (messageId: string) => Promise<void>
} {
  return {
    'voice:start': () => voice.start(),
    'voice:finish': () => voice.finish(),
    'voice:stop': () => voice.stop(),
    'voice:speak': (messageId) => voice.speak(messageId)
  }
}
