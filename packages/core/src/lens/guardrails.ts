import type { z } from 'zod'
import type { RewriteModelOutputSchema } from '../schemas/lens'
import type { DomainRisk, RenderAction, SkipReason, Transform } from '../types/lens'
import { MAX_REPLACE_WORDS, TRANSFORM_RULES, countWords } from './transforms'

/**
 * Guardrails applied in the app before anything renders (hoot-lens.md
 * §7.4). Step 1 (JSON + schema) happens in `generateJson`; this module
 * covers steps 2–5 and is pure so it can be tested exhaustively.
 */

export type RewriteModelOutput = z.output<typeof RewriteModelOutputSchema>

export const MIN_CONFIDENCE = 0.6

/** A gloss longer than this is never shown, whatever the transform. */
export const MAX_GLOSS_WORDS = 80

export type GuardrailVerdict =
  | {
      kind: 'accept'
      action: RenderAction
      transform: Transform
      text: string
      term: string | null
      confidence: number
      /** Why the model's "replace" became a gloss, if it did */
      downgraded: DowngradeReason | null
    }
  | { kind: 'skip'; reason: SkipReason }

export type DowngradeReason =
  'high_stakes' | 'gloss_only_transform' | 'long_span' | 'invariants' | 'length' | 'term_missing'

export interface GuardrailInput {
  output: RewriteModelOutput
  /** The original selection */
  span: string
  allowedTransforms: readonly Transform[]
  risk: DomainRisk
  /** Settings → Reading → High-stakes content */
  highStakes: 'gloss' | 'allow-replace'
}

export function applyGuardrails(input: GuardrailInput): GuardrailVerdict {
  const { output, span, allowedTransforms, risk, highStakes } = input
  const text = output.text.trim()

  if (output.action === 'skip') return { kind: 'skip', reason: 'model_skip' }
  if (!output.meaning_preserved) return { kind: 'skip', reason: 'meaning_not_preserved' }
  if (output.confidence < MIN_CONFIDENCE) return { kind: 'skip', reason: 'low_confidence' }
  if (!allowedTransforms.includes(output.transform) || text.length === 0) {
    return { kind: 'skip', reason: 'invalid_output' }
  }

  const transform = output.transform
  const rule = TRANSFORM_RULES[transform]
  let action: RenderAction = output.action
  let downgraded: DowngradeReason | null = null
  const downgrade = (why: DowngradeReason): void => {
    if (action === 'replace') {
      action = 'gloss'
      downgraded = why
    }
  }

  if (risk === 'high' && highStakes === 'gloss') downgrade('high_stakes')
  if (rule.defaultAction === 'gloss') downgrade('gloss_only_transform')
  if (countWords(span) > MAX_REPLACE_WORDS) downgrade('long_span')

  if (action === 'replace') {
    if (transform === 'define' || transform === 'expand') {
      // "term (gloss)": the term must survive, and the gloss must be short.
      if (!text.toLowerCase().includes(span.trim().toLowerCase())) downgrade('term_missing')
      else if (rule.maxWords && countWords(text) - countWords(span) > rule.maxWords) {
        downgrade('length')
      }
    } else if (rule.maxLengthRatio) {
      const allowed = Math.max(
        Math.ceil(countWords(span) * rule.maxLengthRatio),
        countWords(span) + 6
      )
      if (countWords(text) > allowed) downgrade('length')
    }
  }
  if (action === 'replace' && !invariantsHold(span, text, transform)) downgrade('invariants')

  if (countWords(text) > MAX_GLOSS_WORDS) return { kind: 'skip', reason: 'invalid_output' }
  if (action === 'gloss' && (transform === 'define' || transform === 'expand')) {
    // A gloss sits next to the original, so it must not just repeat it.
    if (text.trim().toLowerCase() === span.trim().toLowerCase()) {
      return { kind: 'skip', reason: 'invalid_output' }
    }
  }

  return {
    kind: 'accept',
    action,
    transform,
    text,
    term: output.term?.trim() || null,
    confidence: output.confidence,
    downgraded
  }
}

// ---------------------------------------------------------------- invariants

/** Numbers as written, normalised for thousands separators (EN 1,000.5 and DE 1.000,5). */
export function extractNumbers(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let n = m[0]
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) n = n.replace(/,/g, '')
    else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, '').replace(',', '.')
    else n = n.replace(',', '.')
    out.push(n)
  }
  return out
}

const UNIT_AFTER_NUMBER =
  /\d\s?(%|°[CF]|°|km\/h|kWh|kHz|MHz|GHz|mph|kph|km|cm|mm|nm|µm|kg|mg|µg|ml|KB|MB|GB|TB|Hz|kW|ms|min|lbs?|oz|ft|in|mi|[mgslhVWAKL])(?![A-Za-z])/g
const CURRENCY_BEFORE_NUMBER = /([$€£¥₹₾])\s?\d/g

export function extractUnits(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(UNIT_AFTER_NUMBER)) if (m[1]) out.push(m[1])
  for (const m of text.matchAll(CURRENCY_BEFORE_NUMBER)) if (m[1]) out.push(m[1])
  return out
}

export function extractUrls(text: string): string[] {
  return [...text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi)].map((m) =>
    m[0].replace(/[.,;:!?]+$/, '')
  )
}

const MONTHS =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi

export function extractMonths(text: string): string[] {
  return [...text.matchAll(MONTHS)].map((m) => m[0].slice(0, 3).toLowerCase())
}

/** Negators per language family; Phase-1 languages (hoot-lens.md §16 Q5). */
const NEGATORS = new Set([
  // en ("n't" and "cannot" are normalised to "not" first)
  'not',
  'no',
  'never',
  'without',
  'none',
  'nor',
  'neither',
  'nothing',
  'nobody',
  'nowhere',
  // es / pt / it
  'nunca',
  'sin',
  'ni',
  'ningún',
  'ninguna',
  'ninguno',
  'nadie',
  'nada',
  'não',
  'sem',
  'nenhum',
  'nenhuma',
  'non',
  'mai',
  'senza',
  'nessuno',
  'nessuna',
  // de
  'nicht',
  'kein',
  'keine',
  'keinen',
  'keiner',
  'keinem',
  'keines',
  'nie',
  'niemals',
  'ohne',
  // fr
  'ne',
  'pas',
  'jamais',
  'sans',
  'aucun',
  'aucune'
])

export function extractNegations(text: string): string[] {
  const normalised = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\bcannot\b/g, 'can not')
    .replace(/n't\b/g, ' not')
  return normalised.split(/[^\p{L}']+/u).filter((w) => NEGATORS.has(w))
}

/** Every item of `need` (as a multiset) must occur in `have`. */
function containsAll(need: string[], have: string[]): boolean {
  const pool = new Map<string, number>()
  for (const h of have) pool.set(h, (pool.get(h) ?? 0) + 1)
  for (const n of need) {
    const left = pool.get(n) ?? 0
    if (left === 0) return false
    pool.set(n, left - 1)
  }
  return true
}

/**
 * hoot-lens.md §7.4 step 3: every number, unit, date, URL and negation in
 * the original must appear in a replacement. A translation keeps numbers,
 * units and URLs; its words are in another language, so negations and month
 * names aren't compared.
 */
export function invariantsHold(original: string, rewrite: string, transform: Transform): boolean {
  if (!containsAll(extractNumbers(original), extractNumbers(rewrite))) return false
  if (!containsAll(extractUnits(original), extractUnits(rewrite))) return false
  if (!containsAll(extractUrls(original), extractUrls(rewrite))) return false
  if (transform === 'translate') return true
  if (!containsAll(extractMonths(original), extractMonths(rewrite))) return false
  return containsAll(extractNegations(original), extractNegations(rewrite))
}
