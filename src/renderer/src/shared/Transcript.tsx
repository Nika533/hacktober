import { useEffect, useRef } from 'react'
import type { Attachment, Message } from '../../../shared/types'
import { Markdown } from './Markdown'

function ErrorBody({ m, onRetry }: { m: Message; onRetry: () => void }): React.JSX.Element {
  if (m.error === 'no-key') {
    return (
      <div className="msg-error">
        <button
          type="button"
          data-hit
          className="msg-error-cta"
          onClick={() => window.hoot.windows.openSettings()}
        >
          Add your Gemini API key
        </button>
      </div>
    )
  }
  const text =
    m.error === '401'
      ? 'Your API key was rejected. Check it in Settings.'
      : m.error === '429'
        ? 'Rate limited — try again in a moment.'
        : m.error === '529'
          ? 'Gemini is busy right now. Try again shortly.'
          : m.error === 'network'
            ? "Can't reach Gemini. Check your connection."
            : m.error === 'blocked'
              ? 'Gemini declined to answer that one. Try rephrasing.'
              : 'Something went wrong. Please try again.'
  return (
    <div className="msg-error">
      <span className="t-small">{text}</span>
      <button type="button" data-hit className="msg-error-cta" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

export function Transcript({
  messages,
  streaming,
  attachments
}: {
  messages: Message[]
  streaming: boolean
  attachments?: Record<string, Attachment>
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i
    }
    return -1
  })()

  return (
    <div ref={scroller} className="transcript" data-hit>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          const thumbs = m.attachmentIds
            .map((id) => attachments?.[id])
            .filter((a): a is Attachment => !!a)
          return (
            <div key={m.id} className="msg-row user">
              {thumbs.length > 0 ? (
                <div className="msg-attach">
                  {thumbs.map((a) => (
                    <img key={a.id} src={a.thumbDataUrl} alt="capture" />
                  ))}
                </div>
              ) : null}
              <div className="msg-bubble user t-body">{m.text}</div>
            </div>
          )
        }
        const isLast = i === lastAssistantIdx
        return (
          <div key={m.id} className="msg-row assistant">
            {m.status === 'error' ? (
              <ErrorBody m={m} onRetry={() => window.hoot.ai.regenerate()} />
            ) : (
              <>
                <div className="msg-bubble assistant">
                  {m.text ? <Markdown text={m.text} /> : null}
                  {m.status === 'streaming' && !m.text ? <span className="dots">…</span> : null}
                  {m.status === 'stopped' ? <div className="t-small msg-note">Stopped</div> : null}
                </div>
                <div className="msg-actions">
                  {m.status !== 'streaming' ? (
                    <button
                      type="button"
                      data-hit
                      title="Pin as sticky note"
                      onClick={() => window.hoot.pins.create(m.id)}
                    >
                      Pin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-hit
                    onClick={() => window.hoot.clipboard.writeText(m.text)}
                  >
                    Copy
                  </button>
                  {isLast && !streaming ? (
                    <button type="button" data-hit onClick={() => window.hoot.ai.regenerate()}>
                      Regenerate
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
