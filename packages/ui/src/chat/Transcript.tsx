import { useReducedMotion } from 'motion/react'
import { ArrowDown, Check, Copy, Pin, RotateCcw } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { IconButton } from '../components/IconButton'
import { cx } from '../cx'
import { copyText, type CopyFn } from './copyText'
import { describeChatError } from './describeError'
import { ErrorBody } from './ErrorBody'
import { Markdown } from './Markdown'
import { isAtBottom } from './scroll'
import type { MessageStatus } from '@hoot/core'
import type { ChatMessageView } from './types'

export interface TranscriptProps {
  messages: readonly ChatMessageView[]
  /** Retry a failed answer (defaults to onRegenerate). */
  onRetry?: () => void
  /** Regenerate the last answer; the action shows on the last assistant message. */
  onRegenerate?: () => void
  /** Pin an answer as a sticky note. */
  onPin?: (messageId: string) => void
  onAddKey?: () => void
  onOpenSettings?: () => void
  /** Copy for messages and code blocks; defaults to the Clipboard API. */
  onCopy?: CopyFn
  onOpenLink?: (href: string) => void
  /** Shown when there are no messages. */
  empty?: ReactNode
  /** Accessible name of the scroll region. */
  label?: string
  className?: string
}

const COPIED_MS = 1400

/**
 * The conversation. It follows new text only while the reader is at the
 * bottom; scrolling up stops the follow and offers "Jump to latest". Sending
 * a message always returns to the bottom. Text is selectable. Completion,
 * stops and errors are announced once through a polite live region (never
 * the streaming tokens themselves).
 */
export function Transcript({
  messages,
  onRetry,
  onRegenerate,
  onPin,
  onAddKey,
  onOpenSettings,
  onCopy = copyText,
  onOpenLink,
  empty,
  label = 'Conversation',
  className
}: TranscriptProps): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const live = useRef<HTMLSpanElement>(null)
  const pinned = useRef(true)
  const [unpinned, setUnpinned] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  // Stable callbacks for Markdown so finished messages don't re-render on
  // every streamed delta, even when the host passes inline arrows.
  const latest = useRef({ onCopy, onOpenLink })
  useEffect(() => {
    latest.current = { onCopy, onOpenLink }
  })
  const mdCopy = useCallback<CopyFn>((text) => latest.current.onCopy(text), [])
  const hasLinkHandler = onOpenLink !== undefined
  const mdOpenLink = useMemo(
    () => (hasLinkHandler ? (href: string) => latest.current.onOpenLink?.(href) : undefined),
    [hasLinkHandler]
  )

  const toBottom = useCallback(
    (smooth = false): void => {
      const el = scroller.current
      if (!el) return
      if (smooth && !reduced && typeof el.scrollTo === 'function') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      } else {
        el.scrollTop = el.scrollHeight
      }
    },
    [reduced]
  )

  // Follow every render (new deltas) while pinned, before paint.
  useLayoutEffect(() => {
    if (pinned.current) toBottom()
  })

  // The reader just sent something: always go to the bottom.
  const lastUserId = findLast(messages, (m) => m.role === 'user')?.id
  useLayoutEffect(() => {
    pinned.current = true
    toBottom()
  }, [lastUserId, toBottom])

  // Content can also grow without a render (images, fonts, code wrapping).
  useEffect(() => {
    const el = content.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (pinned.current) toBottom()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [toBottom])

  // Announce transitions out of streaming exactly once.
  const statuses = useRef(new Map<string, MessageStatus>())
  useEffect(() => {
    let say = ''
    for (const m of messages) {
      if (m.role !== 'assistant' || statuses.current.get(m.id) !== 'streaming') continue
      if (m.status === 'done') say = 'Hoot answered'
      else if (m.status === 'stopped') say = 'Answer stopped'
      else if (m.status === 'error') say = describeChatError(m.error).message
    }
    statuses.current = new Map(messages.map((m) => [m.id, m.status]))
    const region = live.current
    // A trailing no-break space makes a repeated message count as new.
    if (say && region) region.textContent = region.textContent === say ? `${say}\u00a0` : say
  }, [messages])

  const streaming = messages.some((m) => m.status === 'streaming')
  const lastAssistantId = findLast(messages, (m) => m.role === 'assistant')?.id

  const copy = (m: ChatMessageView): void => {
    void Promise.resolve(onCopy(m.text)).then(() => {
      setCopiedId(m.id)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
      if (live.current) live.current.textContent = 'Copied to clipboard'
    })
  }

  return (
    <div className={cx('hoot-transcript', className)}>
      <div
        ref={scroller}
        className="hoot-transcript__scroller"
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={(e) => {
          const atBottom = isAtBottom(e.currentTarget)
          pinned.current = atBottom
          setUnpinned(!atBottom)
        }}
      >
        <div ref={content} className="hoot-transcript__content">
          {messages.length === 0
            ? empty
            : messages.map((m) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} message={m} />
                ) : (
                  <article
                    key={m.id}
                    className="hoot-msg hoot-msg--assistant"
                    aria-label="Hoot"
                    aria-busy={m.status === 'streaming' || undefined}
                  >
                    {m.text && <Markdown text={m.text} onCopy={mdCopy} onOpenLink={mdOpenLink} />}
                    {!m.text && m.status === 'streaming' && <Thinking />}
                    {m.status === 'stopped' && <p className="hoot-msg__note">Stopped</p>}
                    {m.status === 'error' && (
                      <ErrorBody
                        code={m.error}
                        onRetry={onRetry ?? onRegenerate}
                        onAddKey={onAddKey}
                        onOpenSettings={onOpenSettings}
                      />
                    )}
                    {m.status !== 'streaming' && m.status !== 'error' && (
                      <div className="hoot-msg__actions hoot-chrome">
                        {m.text && (
                          <IconButton
                            size="sm"
                            label={copiedId === m.id ? 'Copied' : 'Copy'}
                            onClick={() => copy(m)}
                          >
                            {copiedId === m.id ? <Check /> : <Copy />}
                          </IconButton>
                        )}
                        {onPin && m.text && (
                          <IconButton size="sm" label="Pin as note" onClick={() => onPin(m.id)}>
                            <Pin />
                          </IconButton>
                        )}
                        {onRegenerate && m.id === lastAssistantId && !streaming && (
                          <IconButton size="sm" label="Regenerate" onClick={onRegenerate}>
                            <RotateCcw />
                          </IconButton>
                        )}
                      </div>
                    )}
                  </article>
                )
              )}
        </div>
      </div>
      {unpinned && messages.length > 0 && (
        <IconButton
          label="Jump to latest"
          className="hoot-transcript__jump hoot-material hoot-material--chip"
          onClick={() => {
            pinned.current = true
            toBottom(true)
          }}
        >
          <ArrowDown />
        </IconButton>
      )}
      <span ref={live} className="hoot-visually-hidden" aria-live="polite" />
    </div>
  )
}

function UserMessage({ message: m }: { message: ChatMessageView }): React.JSX.Element {
  const attachments = m.attachments ?? []
  return (
    <article className="hoot-msg hoot-msg--user" aria-label="You">
      {attachments.length > 0 && (
        <div className="hoot-msg__attachments">
          {attachments.map((a, i) => (
            <img
              key={a.id}
              src={a.thumbUrl}
              alt={a.label ?? `Capture ${i + 1}`}
              draggable={false}
            />
          ))}
        </div>
      )}
      {m.text && <div className="hoot-msg__bubble">{m.text}</div>}
    </article>
  )
}

function Thinking(): React.JSX.Element {
  return (
    <div className="hoot-thinking">
      <span className="hoot-visually-hidden">Hoot is thinking</span>
      <span className="hoot-thinking__dot" aria-hidden />
      <span className="hoot-thinking__dot" aria-hidden />
      <span className="hoot-thinking__dot" aria-hidden />
    </div>
  )
}

function findLast<T>(list: readonly T[], pred: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item !== undefined && pred(item)) return item
  }
  return undefined
}
