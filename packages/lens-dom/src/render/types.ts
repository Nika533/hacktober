import type { MarkAction, Transform } from '../contract'

export type GlossPlacement = 'inline' | 'block'

export interface MarkSpec {
  action: MarkAction
  transform: Transform
  text: string
  highStakes?: boolean
  placement?: GlossPlacement
}

export interface Mark {
  readonly id: string
  readonly spec: MarkSpec
  readonly original: string
  readonly anchor: HTMLElement
  rects(): DOMRect[]
}

export type BlockReason =
  | 'collapsed'
  | 'detached'
  | 'editable'
  | 'code'
  | 'quote'
  | 'link'
  | 'hidden'
  | 'marked'
  | 'lens-ui'
  | 'multi-block'
  | 'too-long'
  | 'no-text'

export type RangeCheck = { ok: true } | { ok: false; reason: BlockReason }

export interface ApplyOptions {
  animate?: boolean
}

export type DropListener = (mark: Mark) => void

export interface Renderer {
  readonly kind: string
  check(range: Range, spec?: MarkSpec): RangeCheck
  apply(range: Range, spec: MarkSpec, options?: ApplyOptions): Mark | null
  restore(id: string, options?: ApplyOptions): boolean
  restoreAll(options?: ApplyOptions): number
  get(id: string): Mark | undefined
  marks(): Mark[]
  onDrop(listener: DropListener): () => void
  destroy(): void
}
