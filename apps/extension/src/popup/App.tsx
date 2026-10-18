import { Button, IconButton, Owl } from '@hoot/ui'
import { ArrowUp, Mic } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import type { BridgeStatus, CurrentPage, Reply } from '../messages'
import { speechErrorText, type CreateRecognizer, type Recognizer } from './speech'

/** How the popup reaches the service worker (chrome.runtime in the extension). */
export interface PopupHost {
  request<T>(message: unknown): Promise<Reply<T>>
  /** Whether this extension may use the microphone. */
  micPermission(): Promise<PermissionState>
  /** Open the page that asks for the microphone (a popup can't show the prompt). */
  openMicSetup(): void
  close(): void
}

type Phase = 'idle' | 'listening' | 'sending' | 'sent'

const BLOCKED_TEXT: Record<NonNullable<CurrentPage['blocked']>, string> = {
  private: 'Hoot keeps this page private, so it won’t read it. You can still ask.',
  never: 'You told Hoot never to read this site. You can still ask.',
  unreadable: 'Hoot can’t read this kind of page. You can still ask.',
  off: 'Reading pages is off on the options page. You can still ask.'
}

const NOT_RUNNING = 'Hoot isn’t running. Open Hoot on this computer, then try again.'

/**
 * The toolbar popup: ask Hoot about the page in front. Type, or press the
 * mic and talk (the browser's speech recognition); a spoken question goes as
 * soon as you stop, and Hoot answers aloud in its chat on the desktop.
 */
export function PopupApp({
  host,
  recognizer
}: {
  host: PopupHost
  recognizer: CreateRecognizer | null
}): React.JSX.Element {
  const inputId = useId()
  const [page, setPage] = useState<CurrentPage | null>(null)
  const [running, setRunning] = useState<boolean | null>(null)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [spoken, setSpoken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsMic, setNeedsMic] = useState(false)
  const listening = useRef<Recognizer | null>(null)
  const heard = useRef({ text: '', final: false })
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void host.request<CurrentPage | null>({ type: 'page.current' }).then((r) => {
      if (r.ok) setPage(r.value)
    })
    void host.request<BridgeStatus>({ type: 'lens.status' }).then((r) => {
      setRunning(r.ok && r.value.state === 'connected')
    })
    return () => listening.current?.abort()
  }, [host])

  const send = useCallback(
    async (question: string, voice: boolean): Promise<void> => {
      const trimmed = question.trim()
      if (!trimmed) return
      setPhase('sending')
      setError(null)
      const reply = await host.request<null>({ type: 'page.ask', text: trimmed, voice })
      if (!reply.ok) {
        setPhase('idle')
        setError(
          reply.error.code === 'app_unavailable' ? NOT_RUNNING : 'Hoot didn’t get that. Try again.'
        )
        return
      }
      setSpoken(voice)
      setPhase('sent')
      setTimeout(() => host.close(), 1600)
    },
    [host]
  )

  const listen = async (): Promise<void> => {
    if (!recognizer) return
    if (phase === 'listening') {
      listening.current?.stop()
      return
    }
    setError(null)
    if ((await host.micPermission()) !== 'granted') {
      setNeedsMic(true)
      return
    }
    heard.current = { text: '', final: false }
    const r = recognizer({
      heard: (said, final) => {
        heard.current = { text: said, final }
        setText(said)
      },
      error: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') setNeedsMic(true)
        else if (code !== 'aborted') setError(speechErrorText(code))
      },
      end: () => {
        listening.current = null
        setPhase((p) => (p === 'listening' ? 'idle' : p))
        // A spoken question goes as soon as the speaker stops.
        if (heard.current.text) void send(heard.current.text, true)
      }
    })
    listening.current = r
    setPhase('listening')
    try {
      r.start()
    } catch {
      listening.current = null
      setPhase('idle')
      setError(speechErrorText('unknown'))
    }
  }

  if (phase === 'sent') {
    return (
      <main className="hoot-popup hoot-popup--sent">
        <Owl mood="celebrate" size={48} />
        <p className="hoot-popup__sent" role="status">
          {spoken
            ? 'Sent. Hoot answers in its chat and reads it to you.'
            : 'Sent. Hoot’s answer is in its chat.'}
        </p>
      </main>
    )
  }

  const busy = phase === 'sending'
  const isListening = phase === 'listening'
  return (
    <main className="hoot-popup">
      <header className="hoot-popup__header">
        <Owl mood={isListening ? 'listening' : busy ? 'thinking' : 'idle'} size={40} />
        <div className="hoot-popup__heading">
          <h1 className="hoot-popup__title">Ask Hoot about this page</h1>
          {page && (
            <p className="hoot-popup__page" title={page.url}>
              {page.title || page.url || 'This tab'}
            </p>
          )}
        </div>
      </header>

      {page?.blocked && <p className="hoot-popup__note">{BLOCKED_TEXT[page.blocked]}</p>}
      {running === false && !error && <p className="hoot-popup__note">{NOT_RUNNING}</p>}

      <form
        className="hoot-popup__form"
        data-listening={isListening || undefined}
        onSubmit={(e) => {
          e.preventDefault()
          void send(text, false)
        }}
      >
        <label htmlFor={inputId} className="hoot-visually-hidden">
          Your question
        </label>
        <textarea
          id={inputId}
          ref={input}
          className="hoot-popup__input"
          rows={3}
          autoFocus
          placeholder={isListening ? 'Listening…' : 'What does this mean? Summarize it…'}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send(text, false)
            }
          }}
        />
        <div className="hoot-popup__actions">
          {recognizer && (
            <IconButton
              label={isListening ? 'Done talking' : 'Ask by voice'}
              variant={isListening ? 'accent' : 'ghost'}
              className="hoot-voice-btn hoot-popup__mic"
              aria-pressed={isListening}
              disabled={busy}
              style={{ '--hoot-voice-level': isListening ? 0.6 : 0 } as CSSProperties}
              data-phase={isListening ? 'listening' : 'off'}
              onClick={() => void listen()}
            >
              <Mic />
            </IconButton>
          )}
          <IconButton
            type="submit"
            label="Send to Hoot"
            shortcut="Enter"
            variant="accent"
            disabled={busy || !text.trim()}
          >
            <ArrowUp strokeWidth={2.4} />
          </IconButton>
        </div>
      </form>

      {needsMic && (
        <div className="hoot-popup__mic-setup" role="alert">
          <p>Let Hoot use your microphone once, in a new tab. Then press the mic here again.</p>
          <Button size="sm" variant="primary" onClick={host.openMicSetup}>
            Allow the microphone
          </Button>
        </div>
      )}
      {error && (
        <p className="hoot-popup__error" role="alert">
          {error}
        </p>
      )}
      <p className="hoot-popup__footer">
        Alt+Shift+H opens this. Hoot answers in its chat on your desktop.
      </p>
    </main>
  )
}
