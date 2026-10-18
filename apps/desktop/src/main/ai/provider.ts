import { createClaudeProvider } from './claude'
import type { AiProvider } from './types'

/** The provider for a stored key. Hoot runs on Claude (Anthropic). */
export function createAiProvider(key: string): AiProvider {
  return createClaudeProvider(key)
}
