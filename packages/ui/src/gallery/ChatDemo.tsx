import { PencilLine } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AttachmentsRow } from '../chat/AttachmentsRow'
import { ClipboardChip } from '../chat/ClipboardChip'
import { Composer } from '../chat/Composer'
import { ErrorBody } from '../chat/ErrorBody'
import { QuickChips } from '../chat/QuickChips'
import { Transcript } from '../chat/Transcript'
import type { ChatAttachmentView, ChatMessageView } from '../chat/types'
import { IconButton } from '../components/IconButton'
import { useToast } from '../components/toastContext'
import { CHART, CONVERSATION, QUICK_ACTIONS, STREAM_REPLY, TABLE } from './fixtures'

const PENDING: ChatAttachmentView[] = [
  { id: 'p1', thumbUrl: TABLE, label: 'Table capture' },
  { id: 'p2', thumbUrl: CHART, label: 'Chart capture' }
]

const ERROR_CODES = ['no_key', 'auth', 'rate_limited', 'busy', 'network', 'blocked'] as const

/** A working Buddy-card-sized chat on fake streaming, plus every error state. */
export function ChatDemo(): React.JSX.Element {
  const toast = useToast()
  const [messages, setMessages] = useState<ChatMessageView[]>(CONVERSATION)
  const [pending, setPending] = useState<ChatAttachmentView[]>(PENDING)
  const [clipShown, setClipShown] = useState(true)
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)
  const seq = useRef(0)
  useEffect(() => () => clearInterval(timer.current), [])

  const streaming = messages.some((m) => m.status === 'streaming')

  const stream = (replyId: string): void => {
    const words = STREAM_REPLY.split(' ')
    let n = 0
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      n += 1
      const done = n >= words.length
      setMessages((ms) =>
        ms.map((m) =>
          m.id === replyId
            ? { ...m, text: words.slice(0, n).join(' '), status: done ? 'done' : 'streaming' }
            : m
        )
      )
      if (done) clearInterval(timer.current)
    }, 50)
  }

  const ask = (text: string): void => {
    seq.current += 1
    const id = `demo-${seq.current}`
    setMessages((ms) => [
      ...ms,
      { id: `${id}-u`, role: 'user', text, status: 'done', attachments: pending },
      { id: `${id}-a`, role: 'assistant', text: '', status: 'streaming' }
    ])
    setPending([])
    setArmed(false)
    stream(`${id}-a`)
  }

  const stop = (): void => {
    clearInterval(timer.current)
    setMessages((ms) => ms.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m)))
  }

  const regenerate = (): void => {
    const last = messages.findLast((m) => m.role === 'assistant')
    if (!last) return
    setMessages((ms) =>
      ms.map((m) =>
        m.id === last.id ? { ...m, text: '', status: 'streaming', error: undefined } : m
      )
    )
    stream(last.id)
  }

  return (
    <div className="gallery__chat">
      <div className="gallery__card hoot-material hoot-material--card">
        <Transcript
          messages={messages}
          onRegenerate={regenerate}
          onPin={() => toast.show({ message: 'Pinned as a note' })}
          onCopy={(text) => navigator.clipboard?.writeText(text).catch(() => undefined)}
        />
        <div className="gallery__card-bottom">
          {clipShown && (
            <ClipboardChip
              kind="text"
              chars={1240}
              armed={armed}
              onToggle={() => setArmed((a) => !a)}
              onDismiss={() => setClipShown(false)}
            />
          )}
          <AttachmentsRow
            attachments={pending}
            onRemove={(id) => setPending((p) => p.filter((a) => a.id !== id))}
          />
          {pending.length > 0 && (
            <QuickChips
              actions={QUICK_ACTIONS}
              disabled={streaming}
              onPick={(id) => ask(QUICK_ACTIONS.find((a) => a.id === id)?.label ?? id)}
            />
          )}
          <Composer
            streaming={streaming}
            onSend={ask}
            onStop={stop}
            onEmptySend={pending.length > 0 ? () => ask('Explain') : undefined}
            actions={
              <IconButton label="Circle anything" shortcut="Ctrl+Alt+Space" size="sm">
                <PencilLine />
              </IconButton>
            }
          />
        </div>
      </div>
      <ul className="gallery__errors">
        {ERROR_CODES.map((code) => (
          <li key={code}>
            <code className="hoot-t-caption hoot-t-secondary">{code}</code>
            <ErrorBody code={code} onRetry={() => undefined} onAddKey={() => undefined} />
          </li>
        ))}
      </ul>
    </div>
  )
}
