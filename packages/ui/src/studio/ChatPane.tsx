import { Bot, Minimize2, Plus } from 'lucide-react'
import { useId, type ReactNode, type Ref } from 'react'
import { Composer } from '../chat/Composer'
import { Transcript, type TranscriptProps } from '../chat/Transcript'
import { IconButton } from '../components/IconButton'
import { Owl } from '../components/Owl'

export interface ChatPaneProps extends Omit<TranscriptProps, 'empty' | 'label' | 'className'> {
  /** Session title; null for a fresh, unsaved chat. */
  title: string | null
  streaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  onNewChat: () => void
  /** Call another agent: a chat of its own that works at the same time. */
  onNewAgent?: () => void
  /** Back to the Buddy card (Ctrl+L). */
  onLock: () => void
  /** Allows an empty send (pending captures → Explain). */
  onEmptySend?: () => void
  /** Chips, attachments, clipboard suggestion: shown above the composer. */
  composerTop?: ReactNode
  /** Extra buttons left of Send (the mic). */
  composerActions?: ReactNode
  /** Remount key for the composer (to pre-fill it, e.g. Explain more). */
  composerKey?: string
  composerSeed?: string
  composerRef?: Ref<HTMLTextAreaElement>
  /** The capture shortcut for the welcome hint, e.g. 'Ctrl+Alt+Space'. */
  captureShortcut?: string
}

/** Studio's chat column: header, transcript (or a welcome), composer. */
export function ChatPane({
  title,
  streaming,
  onSend,
  onStop,
  onNewChat,
  onNewAgent,
  onLock,
  onEmptySend,
  composerTop,
  composerActions,
  composerKey,
  composerSeed,
  composerRef,
  captureShortcut = 'Ctrl+Alt+Space',
  messages,
  ...transcript
}: ChatPaneProps): React.JSX.Element {
  const titleId = useId()
  return (
    <section className="hoot-chat-pane" aria-labelledby={titleId}>
      <header className="hoot-chat-pane__header hoot-studio-drag">
        <h1 id={titleId} className="hoot-chat-pane__title">
          {title || 'New chat'}
        </h1>
        <div className="hoot-chat-pane__actions hoot-studio-no-drag">
          <IconButton label="New chat" shortcut="Ctrl+N" onClick={onNewChat}>
            <Plus />
          </IconButton>
          {onNewAgent && (
            <IconButton label="New agent, working alongside this chat" onClick={onNewAgent}>
              <Bot />
            </IconButton>
          )}
          <IconButton label="Back to the card" shortcut="Ctrl+L" onClick={onLock}>
            <Minimize2 />
          </IconButton>
        </div>
      </header>
      <Transcript
        {...transcript}
        messages={messages}
        className="hoot-chat-pane__transcript"
        empty={
          <div className="hoot-chat-pane__empty">
            <Owl mood="idle" size={72} />
            <p className="hoot-chat-pane__empty-title">What can I help with?</p>
            <p className="hoot-chat-pane__empty-hint">
              Ask anything, or press {captureShortcut} to circle something on screen first.
            </p>
          </div>
        }
      />
      <div className="hoot-chat-pane__bottom">
        {composerTop}
        <Composer
          key={composerKey}
          seed={composerSeed}
          inputRef={composerRef}
          streaming={streaming}
          onSend={onSend}
          onStop={onStop}
          onEmptySend={onEmptySend}
          actions={composerActions}
        />
      </div>
    </section>
  )
}
