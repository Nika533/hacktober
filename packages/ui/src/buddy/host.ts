import type { HootApi } from '@hoot/core'

/** The part of `window.hoot` the Buddy window uses (the gallery fakes exactly this). */
export type BuddyHost = Pick<
  HootApi,
  'buddy' | 'chat' | 'clipboard' | 'attachments' | 'capture' | 'pins' | 'windows' | 'app' | 'voice'
>
