import type { CodeActionResult, CodeTagState } from '@hoot/core/code'
import type { CodeService } from './service'

/**
 * Handlers for the `code:*` channels (the live overlay's Show and Apply).
 * d1 registers them once: `registerHandlerMap(createCodeHandlers(ctx.code))`.
 */
export function createCodeHandlers(code: CodeService): {
  'code:apply': (messageId: string, index: number) => Promise<CodeActionResult>
  'code:reveal': (messageId: string, index: number) => Promise<CodeActionResult>
  'code:tagStates': (messageId: string) => Promise<CodeTagState[] | null>
} {
  return {
    'code:apply': (messageId, index) => code.apply(messageId, index),
    'code:reveal': (messageId, index) => code.reveal(messageId, index),
    'code:tagStates': async (messageId) => code.tagStates(messageId)
  }
}
