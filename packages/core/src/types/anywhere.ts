import type { BridgeErrorCode } from '../protocol/bridge'
import type { RewriteResult } from './lens'

/** What the Lens anywhere bubble asks main to do (`anywhere.act`). */
export const ANYWHERE_ACTIONS = [
  'copy',
  'pin',
  'explain',
  'chat',
  'knewIt',
  'retry',
  'settings',
  'reading'
] as const
export type AnywhereAction = (typeof ANYWHERE_ACTIONS)[number]

export type AnywhereStatus = 'loading' | 'done' | 'skipped' | 'empty' | 'error'

/**
 * Lens anywhere: text selected in any desktop app, explained in a bubble
 * under the selection after the Lens hotkey. Main owns this state and pushes
 * every change to the bubble on `anywhere:update`.
 */
export interface AnywhereState {
  /** Changes on every hotkey press: the bubble replays its entrance and restarts its idle timer. */
  id: number
  status: AnywhereStatus
  /** The selected text; '' when nothing was selected. */
  original: string
  /** The app the text came from (process name); '' when unknown. */
  app: string
  result: RewriteResult | null
  /** What to tell the user in the skipped, empty and error states. */
  message: string | null
  error: {
    code: BridgeErrorCode
    action?: Extract<AnywhereAction, 'settings' | 'reading' | 'retry'>
  } | null
  /** The bubble sits below or above the selection and enters from that side. */
  side: 'below' | 'above'
}
