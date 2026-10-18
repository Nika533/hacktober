/**
 * @hoot/core: contracts and pure logic shared by the desktop app, the
 * extension, lens-dom and hoot-bridge. No Node, Electron, DOM or React.
 *
 * Entry points:
 * - `@hoot/core`          types, models, chat helpers, lens helpers, IPC routes, framing
 * - `@hoot/core/schemas`  zod schemas for every boundary, settings migration
 * - `@hoot/core/testing`  fakes for tests and HOOT_FAKE_LENS
 *
 * This entry never imports zod, so bundles that only need types and pure
 * helpers (the content script) stay small.
 */

export * from './types/anywhere'
export * from './types/app'
export * from './types/chat'
export * from './types/lens'
export * from './types/settings'
export * from './types/state'
export * from './models'

export * from './chat/conversation'
export * from './chat/prompts'
export * from './chat/sessions'

export * from './util/accelerator'
export * from './util/clipboard'
export * from './util/geometry'

export * from './lens/cacheKey'
export * from './lens/guardrails'
export * from './lens/learning'
export * from './lens/profile'
export * from './lens/prompts'
export * from './lens/risk'
export * from './lens/score'
export * from './lens/transforms'

export * from './protocol/backend'
export * from './protocol/constants'
export * from './protocol/framing'
export type {
  AppMessage,
  AppToExt,
  BridgeAuth,
  BridgeErrorCode,
  Browser,
  ExtMessage,
  ExtRequestType,
  ExtToApp
} from './protocol/bridge'

export type * from './ipc/api'
export * from './ipc/routes'
