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
  | 'embedded'
  | 'marked'
  | 'lens-ui'
  | 'multi-block'
  | 'too-long'
  | 'no-text'

export type RangeCheck = { ok: true } | { ok: false; reason: BlockReason }

export interface ApplyOptions {
  animate?: boolean
}

export interface RestoreOptions {
  animate?: boolean
}

export type RendererEvent =
  { type: 'dropped'; mark: Mark } | { type: 'reapplied'; mark: Mark; previousId: string }

export type RendererListener = (event: RendererEvent) => void

export interface Renderer {
  readonly kind: string
  check(range: Range, spec?: MarkSpec): RangeCheck
  apply(range: Range, spec: MarkSpec, options?: ApplyOptions): Mark | null
  restore(id: string, options?: RestoreOptions): boolean
  restoreAll(options?: RestoreOptions): number
  get(id: string): Mark | undefined
  marks(): Mark[]
  subscribe(listener: RendererListener): () => void
  destroy(): void
}
