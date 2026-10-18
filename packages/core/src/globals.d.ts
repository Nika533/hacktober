/**
 * @hoot/core compiles without DOM or Node typings so it can't depend on
 * either. These globals exist in every runtime it targets (Node, Electron
 * renderers, extension pages and service workers).
 */

interface TextEncoder {
  encode(input?: string): Uint8Array
}
declare const TextEncoder: { new (): TextEncoder }

interface TextDecoder {
  decode(input?: Uint8Array): string
}
declare const TextDecoder: {
  new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }): TextDecoder
}

interface AbortSignal {
  readonly aborted: boolean
  readonly reason: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

declare function setTimeout(handler: () => void, timeout?: number): unknown
declare function clearTimeout(id: unknown): void
