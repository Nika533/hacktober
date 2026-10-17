export type { MarkAction, Transform } from './contract'
export { COPY, TRANSFORM_LABEL, describeMark } from './copy'
export { blockOf } from './blocks'
export { findTextRange } from './find'
export { MARK_TAG, MAX_SPAN_CHARS, UI_TAG, checkRange, isInsideLens } from './guard'
export { InlineRenderer, type InlineRendererOptions } from './render/inline'
export type {
  ApplyOptions,
  BlockReason,
  GlossPlacement,
  Mark,
  MarkSpec,
  RangeCheck,
  Renderer,
  RendererEvent,
  RendererListener
} from './render/types'
export { Popover, type PopoverHandlers } from './ui/popover'
export { placeNear, type Placement } from './ui/position'
export { createUiRoot, type UiRoot, type UiRootOptions } from './ui/root'
export { StyleSheets } from './ui/styles'
