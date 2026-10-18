import { describe, expect, it } from 'vitest'
import {
  applyGuardrails,
  extractNegations,
  extractNumbers,
  extractUnits,
  extractUrls,
  invariantsHold,
  type GuardrailInput,
  type RewriteModelOutput
} from '../src/lens/guardrails'
import { TRANSFORMS, type Transform } from '../src/types/lens'

const out = (o: Partial<RewriteModelOutput>): RewriteModelOutput => ({
  action: 'replace',
  transform: 'simplify',
  text: 'The errors spread out more as values grow.',
  term: null,
  meaning_preserved: true,
  confidence: 0.9,
  ...o
})

const run = (
  o: Partial<RewriteModelOutput>,
  extra: Partial<Omit<GuardrailInput, 'output'>> = {}
): ReturnType<typeof applyGuardrails> =>
  applyGuardrails({
    output: out(o),
    span: 'The residuals exhibit heteroscedasticity across fitted values.',
    allowedTransforms: [...TRANSFORMS],
    risk: 'normal',
    highStakes: 'gloss',
    ...extra
  })

const verdict = (v: ReturnType<typeof applyGuardrails>): string =>
  v.kind === 'skip' ? `skip:${v.reason}` : `${v.action}${v.downgraded ? `:${v.downgraded}` : ''}`

describe('applyGuardrails: drop rules (§7.4 step 2)', () => {
  it.each([
    [{ action: 'skip' as const }, 'skip:model_skip'],
    [{ meaning_preserved: false }, 'skip:meaning_not_preserved'],
    [{ confidence: 0.59 }, 'skip:low_confidence'],
    [{ confidence: 0 }, 'skip:low_confidence'],
    [{ confidence: 0.6 }, 'replace'],
    [{ text: '   ' }, 'skip:invalid_output'],
    [{ text: '' }, 'skip:invalid_output'],
    [{ text: 'word '.repeat(81) }, 'skip:invalid_output']
  ])('%o → %s', (o, expected) => {
    expect(verdict(run(o))).toBe(expected)
  })

  it('skips a transform that was not allowed', () => {
    expect(verdict(run({ transform: 'translate' }, { allowedTransforms: ['simplify'] }))).toBe(
      'skip:invalid_output'
    )
  })

  it('checks skip before confidence, and meaning before confidence', () => {
    expect(verdict(run({ action: 'skip', confidence: 0.1 }))).toBe('skip:model_skip')
    expect(verdict(run({ meaning_preserved: false, confidence: 0.1 }))).toBe(
      'skip:meaning_not_preserved'
    )
  })
})

describe('applyGuardrails: forced glosses (§7.4 steps 4–5)', () => {
  it('forces gloss on high-stakes pages unless the user allowed replace', () => {
    expect(verdict(run({}, { risk: 'high' }))).toBe('gloss:high_stakes')
    expect(verdict(run({}, { risk: 'high', highStakes: 'allow-replace' }))).toBe('replace')
    expect(verdict(run({ action: 'gloss' }, { risk: 'high' }))).toBe('gloss')
  })

  it.each<[Transform, string]>([
    ['example', 'gloss:gloss_only_transform'],
    ['unpack', 'gloss:gloss_only_transform'],
    ['simplify', 'replace']
  ])('%s with action replace → %s', (transform, expected) => {
    expect(verdict(run({ transform }))).toBe(expected)
  })

  it('glosses spans longer than 40 words', () => {
    const span = 'word '.repeat(41).trim()
    expect(verdict(run({ text: 'short' }, { span }))).toBe('gloss:long_span')
  })

  it('caps simplify at 1.5x the original words, with a floor of +6', () => {
    const span = 'w '.repeat(20).trim()
    expect(verdict(run({ text: 'a '.repeat(30).trim() }, { span }))).toBe('replace')
    expect(verdict(run({ text: 'a '.repeat(31).trim() }, { span }))).toBe('gloss:length')
    expect(verdict(run({ text: 'a b c d e f g h' }, { span: 'API' }))).toBe('gloss:length')
    expect(verdict(run({ text: 'a b c d e f g' }, { span: 'API' }))).toBe('replace')
  })
})

describe('applyGuardrails: define and expand', () => {
  const term = (o: Partial<RewriteModelOutput>, span = 'heteroscedasticity'): string =>
    verdict(run({ transform: 'define', term: span, ...o }, { span }))

  it('accepts "term (gloss)" with a short gloss', () => {
    expect(term({ text: 'heteroscedasticity (when the spread of errors changes)' })).toBe('replace')
  })

  it('downgrades when the term is missing from the replacement', () => {
    expect(term({ text: 'when the spread of errors changes' })).toBe('gloss:term_missing')
  })

  it('downgrades a gloss longer than 15 words', () => {
    const long = `heteroscedasticity (${'w '.repeat(16).trim()})`
    expect(term({ text: long })).toBe('gloss:length')
  })

  it('is case-insensitive about the term', () => {
    expect(term({ text: 'API (a way programs talk)', transform: 'expand' }, 'api')).toBe('replace')
  })

  it('skips a gloss that only repeats the original', () => {
    expect(term({ action: 'gloss', text: 'Heteroscedasticity' })).toBe('skip:invalid_output')
  })

  it('normalises the term', () => {
    const v = run({ transform: 'define', term: '  API ', text: 'API (x)' }, { span: 'API' })
    expect(v.kind === 'accept' && v.term).toBe('API')
    const none = run({ transform: 'define', term: '   ', text: 'API (x)' }, { span: 'API' })
    expect(none.kind === 'accept' && none.term).toBeNull()
  })
})

describe('invariants (§7.4 step 3)', () => {
  it.each<[string, string, boolean]>([
    // numbers
    ['Revenue rose 12% to $3.4 million.', 'Revenue went up 12% to $3.4 million.', true],
    ['Revenue rose 12% to $3.4 million.', 'Revenue went up to $3.4 million.', false],
    ['Revenue rose 12% to $3.4 million.', 'Revenue rose 12% to $34 million.', false],
    ['It costs 1,000 dollars.', 'It costs 1000 dollars.', true],
    ['Es kostet 1.000,50 Euro.', 'Der Preis ist 1.000,50 Euro.', true],
    ['Take 2 pills, 3 times a day.', 'Take 3 pills, 2 times a day.', true],
    ['Take 2 pills, 2 times a day.', 'Take 2 pills a day.', false],
    // units and currency
    ['The limit is 50 km/h.', 'You may drive 50 km/h at most.', true],
    ['The limit is 50 km/h.', 'You may drive 50 at most.', false],
    ['Use 5 mg daily.', 'Use 5 g daily.', false],
    ['It weighs 2kg.', 'Its weight is 2 kg.', true],
    ['It costs €20.', 'The price is 20.', false],
    ['It costs €20.', 'The price is € 20.', true],
    // URLs
    ['See https://example.com/docs for details.', 'Details: https://example.com/docs.', true],
    ['See https://example.com/docs for details.', 'Details are online.', false],
    ['Visit www.example.org today.', 'Go to www.example.org now.', true],
    // dates
    ['Due on 3 March 2025.', 'You must finish by 3 March 2025.', true],
    ['Due on 3 March 2025.', 'You must finish by 3 May 2025.', false],
    ['Effective Jan 5.', 'Starts January 5.', true],
    // negations
    ['This is not covered.', 'This is not included.', true],
    ['This is not covered.', 'This is covered.', false],
    ["This isn't covered.", 'This is not covered.', true],
    ['You cannot cancel.', "You can't cancel.", true],
    ['Never share your key.', 'Do not share your key.', false],
    ['Never share your key.', 'Never give out your key.', true],
    ['Use it without a license.', 'Use it with no license.', false],
    ['No refunds.', 'There are no refunds.', true],
    ['Das ist nicht erlaubt.', 'Das ist nicht gestattet.', true],
    ['Das ist nicht erlaubt.', 'Das ist erlaubt.', false],
    ["Ce n'est pas autorisé.", "Ce n'est pas permis.", true],
    ['No se permite.', 'Se permite.', false],
    // nothing to preserve
    ['Heteroscedasticity hurts inference.', 'Uneven error spread hurts conclusions.', true]
  ])('%s → %s : %s', (original, rewrite, ok) => {
    expect(invariantsHold(original, rewrite, 'simplify')).toBe(ok)
  })

  it('compares only numbers, units and URLs for translations', () => {
    expect(invariantsHold('Das kostet nicht 20 €.', 'That does not cost 20 €.', 'translate')).toBe(
      true
    )
    expect(invariantsHold('Am 3. März um 10 Uhr.', 'On 3 March at 10.', 'translate')).toBe(true)
    expect(invariantsHold('Am 3. März um 10 Uhr.', 'On 4 March at 10.', 'translate')).toBe(false)
  })

  it('downgrades a replacement that breaks an invariant', () => {
    const span = 'Do not exceed 4 g per day.'
    expect(verdict(run({ text: 'Take up to 4 g a day.' }, { span }))).toBe('gloss:invariants')
    expect(verdict(run({ text: 'Do not take more than 4 g a day.' }, { span }))).toBe('replace')
  })

  it('never downgrades on invariants when already a gloss', () => {
    const v = run({ action: 'gloss', text: 'Limit: four grams' }, { span: 'Max 4 g/day.' })
    expect(verdict(v)).toBe('gloss')
  })
})

describe('extractors', () => {
  it('finds numbers, units, urls and negations', () => {
    expect(extractNumbers('1,234.5 and 1.234,5 and 7')).toEqual(['1234.5', '1234.5', '7'])
    expect(extractUnits('3 km, 5%, $4, 6kWh, 2 MB')).toEqual(['km', '%', 'kWh', 'MB', '$'])
    expect(extractUrls('go to https://a.io/x?y=1, then www.b.org.')).toEqual([
      'https://a.io/x?y=1',
      'www.b.org'
    ])
    expect(extractNegations("I can't, won't, and never will. Cannot!")).toEqual([
      'not',
      'not',
      'never',
      'not'
    ])
  })

  it('does not mistake words for units', () => {
    expect(extractUnits('3 apples and 4 mice')).toEqual([])
  })
})
