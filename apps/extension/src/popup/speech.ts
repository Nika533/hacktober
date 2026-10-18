/** The bits of the Web Speech API the popup uses (Chrome: `webkitSpeechRecognition`). */
interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}
interface RecognitionEvent {
  readonly results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

export interface SpeechHandlers {
  /** Everything heard so far; `final` once the phrase is done. */
  heard(text: string, final: boolean): void
  error(code: string): void
  end(): void
}

export interface Recognizer {
  start(): void
  /** Done talking: keep what was heard. */
  stop(): void
  abort(): void
}

export type CreateRecognizer = (handlers: SpeechHandlers) => Recognizer

/** The browser's speech recognition, or null where there is none (e.g. Brave). */
export function browserRecognizer(win: Window, lang: string): CreateRecognizer | null {
  const scope = win as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition
  if (!Ctor) return null
  return (handlers) => {
    const r = new Ctor()
    r.lang = lang
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    r.onresult = (e) => {
      const results = Array.from(e.results)
      const text = results.map((res) => res[0].transcript).join('')
      handlers.heard(text.trim(), results.at(-1)?.isFinal === true)
    }
    r.onerror = (e) => handlers.error(e.error)
    r.onend = () => handlers.end()
    return { start: () => r.start(), stop: () => r.stop(), abort: () => r.abort() }
  }
}

/** Sentences for the recognition errors people actually hit. */
export function speechErrorText(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Hoot needs your permission to use the microphone.'
    case 'no-speech':
      return 'Hoot didn’t hear anything. Press the mic and try again.'
    case 'audio-capture':
      return 'No microphone found. Plug one in and try again.'
    case 'network':
      return 'Speech recognition needs an internet connection. Type your question instead.'
    default:
      return 'Voice didn’t work this time. Try again, or type your question.'
  }
}
