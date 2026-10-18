/**
 * `@hoot/core/code`: the code link between Hoot and VS Code. Types, the
 * pipe and limits, the note that replaces screenshots of code, and the
 * `[[line]]` / `[[edit]]` tags the model answers with. No zod here (the
 * schemas are `@hoot/core/code/schemas`), so renderers can import it.
 */
export * from './types'
export * from './link'
export * from './tags'
export * from './resolve'
export * from './note'
export type {
  CodeAppMessage,
  CodeAppToExt,
  CodeErrorCode,
  CodeExtMessage,
  CodeExtToApp
} from './schemas'
