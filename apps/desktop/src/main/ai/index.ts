/** AI provider layer (owner: C). The rest of main imports only from here. */
export type { AiProvider, ChatStreamRequest, JsonRequest, ThinkingLevel } from './types'
export { AiBlockedError, AiError, AiOutputError, isAbortError, mapAiError } from './errors'
export { createGeminiProvider } from './gemini'
export { createFakeProvider, type FakeProviderOptions } from './fake'
