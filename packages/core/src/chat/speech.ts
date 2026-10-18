/** Said once in place of the answer's code blocks. */
export const CODE_IN_CHAT = 'The code is in the chat.'

/** Any `[[…]]` tag (on-screen marks, code and page tags), optionally in backticks. */
const TAG = /`?\[\[[^\]\n]*\]\]`?/g
const FENCE = /^\s*(`{3,}|~{3,})/
const TABLE_RULE = /^\s*\|?[\s:|-]*-[\s:|-]*$/
const SENTENCE_END = /[.!?…:;]["”’)]*$/
const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu

function inline(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^(\s*>\s?)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>\s]+>|https?:\/\/[^\s)]+/g, 'the link')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\*+|~~/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
    .replace(EMOJI, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The last line without a tag, link or inline code that is still arriving. */
function dropPartialTail(text: string): string {
  const nl = text.lastIndexOf('\n')
  const line = text.slice(nl + 1)
  let cut = line.length
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) cut = line.lastIndexOf('`')
  const tag = line.lastIndexOf('[[')
  if (tag >= 0 && !line.includes(']]', tag)) cut = Math.min(cut, tag)
  const link = line.lastIndexOf('[')
  if (link >= 0 && !/^\[[^\]]*\]\([^)]*\)/.test(line.slice(link))) {
    cut = Math.min(cut, line[link - 1] === '!' ? link - 1 : link)
  }
  return text.slice(0, nl + 1) + line.slice(0, cut)
}

/**
 * A Markdown answer as Hoot says it aloud: no code, tags, links or markup,
 * and every line, heading or list item ends like a sentence so the voice
 * pauses. While `streaming`, a tag, link or inline code still arriving at the
 * end is left out. Text that only grows keeps its spoken prefix stable.
 */
export function speakableText(markdown: string, streaming = false): string {
  const source = (streaming ? dropPartialTail(markdown) : markdown).replace(TAG, '')
  const out: string[] = []
  let fence: string | null = null
  let codeSaid = false
  for (const raw of source.split('\n')) {
    const open = FENCE.exec(raw)
    if (fence !== null) {
      if (open && raw.trim().startsWith(fence) && /^(`+|~+)$/.test(raw.trim())) fence = null
      continue
    }
    if (open) {
      fence = open[1] ?? '```'
      if (!codeSaid) out.push(CODE_IN_CHAT)
      codeSaid = true
      continue
    }
    if (TABLE_RULE.test(raw) && raw.includes('|')) continue
    const text = inline(raw)
    if (!text) continue
    out.push(SENTENCE_END.test(text) ? text : `${text}.`)
  }
  return out.join(' ')
}

/** A spoken sentence ends at . ! ? … with a space after it (the next one has started). */
const BOUNDARY = /[.!?…:;]["”’)]*\s/g

/**
 * The next stretch of `clean` (from `speakableText`) to say, starting at
 * `from`: every sentence finished so far, or with `final` everything left.
 * `end` is where the next call starts. Null when there's nothing to say yet.
 */
export function nextSpeech(
  clean: string,
  from: number,
  final: boolean
): { text: string; end: number } | null {
  if (from >= clean.length) return null
  let end = clean.length
  if (!final) {
    BOUNDARY.lastIndex = from
    let last = -1
    for (let m = BOUNDARY.exec(clean); m; m = BOUNDARY.exec(clean)) last = m.index + m[0].length
    if (last < 0) return null
    end = last
  }
  const text = clean.slice(from, end).trim()
  return text ? { text, end } : null
}
