/**
 * A conservative guess at the language of a text sample, for documents that
 * don't declare one (most PDFs have no /Lang). It returns a BCP 47 primary
 * tag only when the evidence is clear, and '' otherwise: an unknown language
 * never triggers translation, a wrong one would.
 */

/** Scripts that belong to one language. Cyrillic, Arabic, Han or Devanagari don't. */
const SCRIPTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\p{Script=Greek}/u, 'el'],
  [/\p{Script=Hebrew}/u, 'he'],
  [/\p{Script=Georgian}/u, 'ka'],
  [/\p{Script=Armenian}/u, 'hy'],
  [/\p{Script=Thai}/u, 'th'],
  [/\p{Script=Hangul}/u, 'ko'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'ja']
]

/** Frequent function words; a word listed for two languages counts for neither. */
const WORDS: Record<string, string> = {
  en: 'the and of to is that with for are this not from by which but was have it be',
  de: 'der die das und ist nicht mit auf für ein eine dass auch sich wenn sind werden den dem des zu',
  fr: 'le la les et est des une pour qui dans pas sur avec du au ce il sont mais ou',
  es: 'el los las y es por para una con del como pero más se lo su al son',
  it: 'il gli è che per una con non della sono come anche nel alla più',
  pt: 'os é para uma com não dos das mais como em ao pelo foi são',
  nl: 'het een en van dat niet met voor zijn op ook maar bij om worden'
}

const STOPWORDS: Map<string, string> = (() => {
  const seen = new Map<string, string | null>()
  for (const [lang, list] of Object.entries(WORDS)) {
    for (const word of list.split(' ')) seen.set(word, seen.has(word) ? null : lang)
  }
  const unique = new Map<string, string>()
  for (const [word, lang] of seen) if (lang) unique.set(word, lang)
  return unique
})()

/** Letters needed before a script counts, and its share of all letters. */
const MIN_LETTERS = 40
const SCRIPT_SHARE = 0.5
/** Function-word hits needed, and how far ahead of the runner-up the winner must be. */
const MIN_HITS = 4
const LEAD = 2

export function guessLanguage(text: string): string {
  const letters = [...text.matchAll(/\p{L}/gu)].map((m) => m[0])
  if (letters.length < MIN_LETTERS) return ''
  for (const [pattern, lang] of SCRIPTS) {
    const count = letters.filter((ch) => pattern.test(ch)).length
    if (count / letters.length >= SCRIPT_SHARE) return lang
  }
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length
  if (latin / letters.length < SCRIPT_SHARE) return ''
  const hits = new Map<string, number>()
  for (const [word] of text.toLowerCase().matchAll(/\p{L}+/gu)) {
    const lang = STOPWORDS.get(word)
    if (lang) hits.set(lang, (hits.get(lang) ?? 0) + 1)
  }
  const [first, second] = [...hits].sort((a, b) => b[1] - a[1])
  if (!first || first[1] < MIN_HITS || first[1] < LEAD * (second?.[1] ?? 0)) return ''
  return first[0]
}
