import { blockOf } from './blocks'

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu
const MATH = /[\u00b1\u00b2\u00b3\u00b9\u00d7\u00f7\u2070-\u209f\u2200-\u22ff]/u
const GREEK = /[\u0391-\u03a9\u03b1-\u03c9]/u
const ACRONYM = /^(?=(?:.*\p{Lu}){2})[\p{Lu}\p{N}]{2,6}s?$/u
const MOSTLY_CAPS = 0.6

const shouting = (text: string): boolean => {
  const words = (text.match(WORD) ?? []).filter((word) => /\p{L}/u.test(word))
  const caps = words.filter((word) => word === word.toUpperCase()).length
  return words.length >= 4 && caps / words.length >= MOSTLY_CAPS
}

/**
 * s6 (hoot-lens.md §6.1) until the word-frequency lists land: notation and acronyms
 * count as jargon, everything else as 0. Greek letters are notation unless the page is
 * Greek; acronyms don't count inside text that is mostly capitals.
 */
export function rarityOf(span: string, lang: string, paragraph = span): number {
  const greek = lang.toLowerCase().startsWith('el')
  if (MATH.test(span) || (!greek && GREEK.test(span))) return 1
  if (shouting(paragraph)) return 0
  const words = span.match(WORD) ?? []
  const acronyms = words.filter((word) => ACRONYM.test(word)).length
  return 0.8 * Math.min(1, (3 * acronyms) / Math.max(words.length, 3))
}

/** s5: the reader scrolled back up to a paragraph they had already read past. */
export class ReadingTracker {
  readonly #win: Window | null
  #deepest: number

  constructor(doc: Document) {
    this.#win = doc.defaultView
    this.#deepest = this.#win?.scrollY ?? 0
    this.#win?.addEventListener('scroll', this.#onScroll, { passive: true })
  }

  reread(range: Range): number {
    const target = blockOf(range.startContainer) ?? range
    const bottom = target.getBoundingClientRect().bottom + (this.#win?.scrollY ?? 0)
    return bottom < this.#deepest ? 1 : 0
  }

  destroy(): void {
    this.#win?.removeEventListener('scroll', this.#onScroll)
  }

  #onScroll = (): void => {
    this.#deepest = Math.max(this.#deepest, this.#win?.scrollY ?? 0)
  }
}
