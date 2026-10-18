import { MAX_REPLACE_WORDS, countWords, type LensSignals, type SelectionSize } from '@hoot/core'
import { blockOf } from './blocks'
import { isElement } from './dom'
import { trimRange } from './find'
import { isInsideLens } from './guard'
import { normalizeWhitespace } from './text'

export type SelectionSignals = Pick<
  LensSignals,
  'sizeClass' | 'dwellMs' | 'copiedWithinMs' | 'reselectCount'
> & { words: number }

export interface SelectionCandidate {
  range: Range
  text: string
  signals: SelectionSignals
}

export interface SelectionListener {
  settled?(candidate: SelectionCandidate): void
  dwell?(candidate: SelectionCandidate): void
  cleared?(): void
  copied?(info: { text: string; afterSettle: boolean }): void
}

export interface SelectionWatcherOptions {
  document: Document
  settleMs?: number
  dwellMs?: number
  copyWindowMs?: number
  typingCooldownMs?: number
  scrollCooldownMs?: number
  fastScrollPxPerSecond?: number
  now?: () => number
}

const TERM_WORDS = 3
const PHRASE_WORDS = 10
/** Inputs you don't type text into: focusing one (a click on a radio) must not switch Lens off. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
])

export function sizeClass(words: number, multiBlock: boolean): SelectionSize {
  if (multiBlock) return 'multi-paragraph'
  if (words <= TERM_WORDS) return 'term'
  if (words <= PHRASE_WORDS) return 'phrase'
  return words <= MAX_REPLACE_WORDS ? 'sentence' : 'passage'
}

function isTypingKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return (
    event.key.length === 1 ||
    event.key === 'Backspace' ||
    event.key === 'Delete' ||
    event.key === 'Enter'
  )
}

/** The user is typing: a text field or editable content has focus. */
function inEditable(doc: Document): boolean {
  const active = doc.activeElement as HTMLElement | null
  if (!active) return false
  if (active.tagName === 'TEXTAREA' || active.isContentEditable === true) return true
  return active.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((active as HTMLInputElement).type)
}

export class SelectionWatcher {
  readonly #doc: Document
  readonly #listener: SelectionListener
  readonly #settleMs: number
  readonly #dwellMs: number
  readonly #copyWindowMs: number
  readonly #typingCooldownMs: number
  readonly #scrollCooldownMs: number
  readonly #fastScroll: number
  readonly #now: () => number
  readonly #seen = new Map<string, number>()
  #current: SelectionCandidate | null = null
  #changedAt = 0
  #settledAt = 0
  #pointerDown = false
  #typedAt = -Infinity
  #fastScrollAt = -Infinity
  #lastScroll: { y: number; at: number } | null = null
  #settleTimer: ReturnType<typeof setTimeout> | null = null
  #dwellTimer: ReturnType<typeof setTimeout> | null = null
  #active = false

  constructor(options: SelectionWatcherOptions, listener: SelectionListener) {
    this.#doc = options.document
    this.#listener = listener
    this.#settleMs = options.settleMs ?? 300
    this.#dwellMs = options.dwellMs ?? 1200
    this.#copyWindowMs = options.copyWindowMs ?? 2500
    this.#typingCooldownMs = options.typingCooldownMs ?? 1000
    this.#scrollCooldownMs = options.scrollCooldownMs ?? 1000
    this.#fastScroll = options.fastScrollPxPerSecond ?? 2500
    this.#now = options.now ?? (() => Date.now())
    const doc = this.#doc
    doc.addEventListener('selectionchange', this.#onSelectionChange)
    doc.addEventListener('pointerdown', this.#onPointerDown, true)
    doc.addEventListener('pointerup', this.#onPointerUp, true)
    doc.addEventListener('keydown', this.#onKeydown, true)
    doc.addEventListener('keyup', this.#onKeyup, true)
    doc.addEventListener('copy', this.#onCopy, true)
    doc.addEventListener('scroll', this.#onScroll, { capture: true, passive: true })
  }

  current(): SelectionCandidate | null {
    return this.#current
  }

  destroy(): void {
    this.#clearTimers()
    const doc = this.#doc
    doc.removeEventListener('selectionchange', this.#onSelectionChange)
    doc.removeEventListener('pointerdown', this.#onPointerDown, true)
    doc.removeEventListener('pointerup', this.#onPointerUp, true)
    doc.removeEventListener('keydown', this.#onKeydown, true)
    doc.removeEventListener('keyup', this.#onKeyup, true)
    doc.removeEventListener('copy', this.#onCopy, true)
    doc.removeEventListener('scroll', this.#onScroll, { capture: true })
  }

  #read(): { range: Range; text: string } | null {
    const selection = this.#doc.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null
    if (inEditable(this.#doc)) return null
    const range = trimRange(selection.getRangeAt(0))
    const text = normalizeWhitespace(range.toString())
    return text ? { range, text } : null
  }

  #ownSelection(): boolean {
    const anchor = this.#doc.getSelection()?.anchorNode
    return !!anchor && isInsideLens(anchor)
  }

  #onSelectionChange = (): void => {
    if (this.#ownSelection()) return
    this.#clearTimers()
    this.#changedAt = this.#now()
    const read = this.#read()
    if (!read) {
      this.#clear()
      return
    }
    if (this.#current && this.#current.text !== read.text) this.#clear()
    if (!this.#pointerDown) this.#scheduleSettle(this.#settleMs)
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (
      event.composedPath().some((node) => isElement(node as Node) && isInsideLens(node as Node))
    ) {
      return
    }
    this.#pointerDown = true
    this.#clearTimers()
  }

  #onPointerUp = (): void => {
    if (!this.#pointerDown) return
    this.#pointerDown = false
    this.#changedAt = this.#now()
    if (this.#read()) this.#scheduleSettle(this.#settleMs)
  }

  #onKeydown = (event: KeyboardEvent): void => {
    if (isTypingKey(event)) this.#typedAt = this.#now()
  }

  #onKeyup = (event: KeyboardEvent): void => {
    if (event.shiftKey || event.key === 'Shift') this.#changedAt = this.#now()
  }

  #onScroll = (): void => {
    const view = this.#doc.defaultView
    const now = this.#now()
    const y = view?.scrollY ?? 0
    const last = this.#lastScroll
    this.#lastScroll = { y, at: now }
    if (!last || now <= last.at) return
    const speed = (Math.abs(y - last.y) / (now - last.at)) * 1000
    if (speed >= this.#fastScroll) this.#fastScrollAt = now
  }

  #onCopy = (): void => {
    const current = this.#current
    const read = this.#read()
    const text = read?.text ?? current?.text ?? ''
    const sinceSettle = this.#now() - this.#settledAt
    const afterSettle = !!current && sinceSettle <= this.#copyWindowMs
    if (current) current.signals.copiedWithinMs ??= sinceSettle
    if (this.#dwellTimer) clearTimeout(this.#dwellTimer)
    this.#dwellTimer = null
    if (text) this.#listener.copied?.({ text, afterSettle })
  }

  #scheduleSettle(delay: number): void {
    if (this.#settleTimer) clearTimeout(this.#settleTimer)
    this.#settleTimer = setTimeout(() => this.#settle(), delay)
  }

  #cooldownLeft(): number {
    const now = this.#now()
    return Math.max(
      this.#typedAt + this.#typingCooldownMs - now,
      this.#fastScrollAt + this.#scrollCooldownMs - now,
      0
    )
  }

  #settle(): void {
    this.#settleTimer = null
    const read = this.#read()
    if (!read || this.#pointerDown) return
    const wait = this.#cooldownLeft()
    if (wait > 0) {
      this.#scheduleSettle(wait)
      return
    }
    const words = countWords(read.text)
    const multiBlock = blockOf(read.range.startContainer) !== blockOf(read.range.endContainer)
    const reselectCount = this.#seen.get(read.text) ?? 0
    const candidate: SelectionCandidate = {
      range: read.range,
      text: read.text,
      signals: {
        sizeClass: sizeClass(words, multiBlock),
        words,
        dwellMs: this.#now() - this.#changedAt,
        copiedWithinMs: null,
        reselectCount
      }
    }
    this.#seen.set(read.text, reselectCount + 1)
    this.#current = candidate
    this.#settledAt = this.#now()
    this.#active = true
    this.#listener.settled?.(candidate)
    const remaining = this.#dwellMs - candidate.signals.dwellMs
    this.#dwellTimer = setTimeout(() => this.#dwell(candidate), Math.max(remaining, 0))
  }

  #dwell(candidate: SelectionCandidate): void {
    this.#dwellTimer = null
    if (this.#current !== candidate || candidate.signals.copiedWithinMs !== null) return
    const read = this.#read()
    if (!read || read.text !== candidate.text) return
    if (this.#cooldownLeft() > 0) {
      this.#dwellTimer = setTimeout(() => this.#dwell(candidate), this.#cooldownLeft())
      return
    }
    candidate.signals.dwellMs = this.#now() - this.#changedAt
    this.#listener.dwell?.(candidate)
  }

  #clear(): void {
    this.#current = null
    if (!this.#active) return
    this.#active = false
    this.#listener.cleared?.()
  }

  #clearTimers(): void {
    if (this.#settleTimer) clearTimeout(this.#settleTimer)
    if (this.#dwellTimer) clearTimeout(this.#dwellTimer)
    this.#settleTimer = null
    this.#dwellTimer = null
  }
}
