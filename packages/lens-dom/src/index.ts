export type { MarkAction, Transform } from './contract'
export { COPY, TRANSFORM_LABEL, announceChange, changedCount, describeMark } from './copy'
export { blockOf, isBlock } from './blocks'
export {
  CopyController,
  marksIn,
  serializeRange,
  type CopyControllerOptions,
  type CopyMode
} from './clipboard'
export { findTextRange } from './find'
export { MARK_TAG, MAX_SPAN_CHARS, UI_TAG, checkRange, isInsideLens } from './guard'
export {
  DynamicPageDetector,
  STRONG_MARKERS,
  WEAK_MARKERS,
  frameworkMarkers,
  isDynamic,
  type DynamicPageDetectorOptions,
  type DynamicSignals
} from './render/detect'
export { InlineRenderer, type InlineRendererOptions } from './render/inline'
export { OverlayRenderer, type OverlayRendererOptions } from './render/overlay'
export type {
  ApplyOptions,
  BlockReason,
  GlossPlacement,
  Mark,
  MarkSpec,
  RangeCheck,
  Renderer,
  RendererEvent,
  RendererListener,
  RestoreOptions
} from './render/types'
export { AskChip } from './ui/chip'
export { LensUi, type LensUiHandlers, type LensUiOptions } from './ui/lens-ui'
export { DURATION, Presence, SPRING_EASE, criticallyDamped } from './ui/motion'
export { PagePill, type PillHandlers } from './ui/pill'
export { Popover, type PopoverHandlers, type PopoverOptions } from './ui/popover'
export { placeNear, type Box, type Placement } from './ui/position'
export { createUiRoot, type UiRoot, type UiRootOptions } from './ui/root'
export { Shimmer, type ThinkingHandle } from './ui/shimmer'
export { StyleSheets } from './ui/styles'
