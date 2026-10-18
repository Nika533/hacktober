/** Lens anywhere: text selected in any desktop app, explained in a bubble (hoot-lens.md §9.4). */
export {
  ANYWHERE_COPY,
  EMPTY_HIDE_MS,
  createAnywhereService,
  describeAnywhereError,
  type AnywhereDeps,
  type AnywhereService,
  type BubbleHost
} from './service'
export { createBubbleWindow } from './window'
export { createAnywhereHandlers, type Sender } from './ipc'
export { buildAnywhereRequest, sizeClass, type AnywhereRequest } from './lensContext'
export {
  BUBBLE_GAP,
  BUBBLE_MARGIN,
  BUBBLE_MAX_HEIGHT,
  BUBBLE_MIN_HEIGHT,
  BUBBLE_WIDTH,
  bubbleBounds,
  bubbleSide,
  cursorAnchor,
  unionRect,
  type BubbleSide
} from './placement'
