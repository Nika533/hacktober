/**
 * The page link between Hoot and the browser extension: the page in front of
 * the user as text instead of a screenshot, and the `[[find]]` tags that
 * highlight passages on it. No zod here (the schemas are in
 * `@hoot/core/schemas`), so the extension's content script can import it.
 */
export * from './types'
export * from './tags'
export * from './note'
