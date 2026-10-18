import { VOICE_OFF, type Greeting, type ModeLayout, type StateSlices } from '@hoot/core'
import { Maximize2, PencilLine, Plus, X } from 'lucide-react'
import { useId, useMemo } from 'react'
import { AttachmentsRow } from '../chat/AttachmentsRow'
import { ClipboardChip } from '../chat/ClipboardChip'
import { Composer } from '../chat/Composer'
import { QuickChips } from '../chat/QuickChips'
import { Transcript } from '../chat/Transcript'
import { VoiceButton, VoiceStatus, type VoiceControls } from '../chat/Voice'
import { QUICK_ACTION_CHIPS, toAttachmentViews, toMessageViews } from '../chat/views'
import { Chip } from '../components/Chip'
import { IconButton } from '../components/IconButton'
import type { BuddyHost } from './host'

export interface BuddyCardProps {
  host: BuddyHost
  layout: ModeLayout
  chat: StateSlices['chat']
  /** The voice chat; off when the window doesn't subscribe to it. */
  voice?: StateSlices['voice']
  greeting: Greeting | null
  /** Display form, e.g. 'Ctrl+Alt+Space'. */
  captureShortcut: string
  /** Remounts the composer pre-filled (type-to-ask from the pill, Explain more). */
  composerSeed: { key: number; text: string }
  onComposerFocus: (focused: boolean) => void
  onComposerEmpty: (empty: boolean) => void
}

const fire = (p: Promise<unknown>): void => void p.catch(() => undefined)

/** The chat card: header, transcript (or a welcome), composer. The owl perches on a corner. */
export function BuddyCard({
  host,
  layout,
  chat,
  voice = VOICE_OFF,
  greeting,
  captureShortcut,
  composerSeed,
  onComposerFocus,
  onComposerEmpty
}: BuddyCardProps): React.JSX.Element {
  const titleId = useId()
  const talk: VoiceControls = useMemo(
    () => ({
      start: () => fire(host.voice.start()),
      finish: () => fire(host.voice.finish()),
      stop: () => fire(host.voice.stop())
    }),
    [host]
  )
  const session = chat.session
  const messages = useMemo(() => toMessageViews(session), [session])
  const pending = useMemo(
    () => toAttachmentViews(chat.pendingAttachments),
    [chat.pendingAttachments]
  )
  const streaming = chat.stream !== null
  const hint = chat.clipboardHint
  const latest = pending.at(-1)
  // Keep the header or the composer clear of the corner the owl sits on.
  const owlSide = layout.openX === 'right' ? 'start' : 'end'
  const owlEdge = layout.openY === 'down' ? 'top' : 'bottom'
  const canExplain = pending.length > 0 || hint?.selected === true

  return (
    <section
      className="hoot-buddy-card hoot-material hoot-material--card"
      aria-labelledby={titleId}
      data-owl-side={owlSide}
      data-owl-edge={owlEdge}
      data-hit
    >
      <header className="hoot-buddy-card__header hoot-chrome">
        <h1 id={titleId} className="hoot-buddy-card__title">
          {session?.title || 'New chat'}
        </h1>
        <div className="hoot-buddy-card__actions">
          <IconButton label="New chat" shortcut="Ctrl+N" onClick={() => fire(host.chat.newChat())}>
            <Plus />
          </IconButton>
          <IconButton
            label="Open in Studio"
            shortcut="Ctrl+L"
            onClick={() => fire(host.windows.openStudio('chat'))}
          >
            <Maximize2 />
          </IconButton>
          <IconButton label="Close" shortcut="Esc" onClick={() => host.buddy.requestMode('pill')}>
            <X />
          </IconButton>
        </div>
      </header>

      <Transcript
        messages={messages}
        className="hoot-buddy-card__transcript"
        onRegenerate={() => fire(host.chat.regenerate())}
        onPin={(id) => fire(host.pins.create(id))}
        onSpeak={(id) => fire(host.voice.speak(id))}
        onCopy={(text) => host.clipboard.writeText(text)}
        onOpenLink={(href) => fire(host.app.openExternal(href))}
        onAddKey={() => fire(host.windows.openStudio('settings'))}
        onOpenSettings={() => fire(host.windows.openStudio('settings'))}
        empty={
          latest ? (
            <div className="hoot-buddy-card__empty">
              <p className="hoot-buddy-card__empty-title">Ask about your capture</p>
              <img
                className="hoot-buddy-card__capture"
                src={latest.thumbUrl}
                alt="Your latest capture"
                draggable={false}
              />
            </div>
          ) : (
            <div className="hoot-buddy-card__empty">
              <p className="hoot-buddy-card__empty-title">
                {greeting?.title ?? 'What can I help with?'}
              </p>
              <p className="hoot-buddy-card__empty-hint">
                Ask anything, or press {captureShortcut} to circle something on screen.
              </p>
              <Chip icon={<PencilLine />} onClick={() => fire(host.capture.start())}>
                Circle something on screen
              </Chip>
            </div>
          )
        }
      />

      <div className="hoot-buddy-card__bottom">
        <VoiceStatus voice={voice} controls={talk} />
        {hint && (
          <ClipboardChip
            kind={hint.kind}
            chars={hint.chars}
            armed={hint.selected === true}
            onToggle={() => fire(host.clipboard.arm())}
            onDismiss={() => fire(host.clipboard.dismiss())}
          />
        )}
        <AttachmentsRow
          attachments={pending}
          onRemove={(id) => fire(host.attachments.remove(id))}
          onOpen={(id) => fire(host.attachments.open(id))}
        />
        {pending.length > 0 && (
          <QuickChips
            actions={QUICK_ACTION_CHIPS}
            disabled={streaming}
            onPick={(id) => fire(host.chat.send({ quickAction: id }))}
          />
        )}
        <Composer
          key={composerSeed.key}
          seed={composerSeed.text}
          autoFocus
          streaming={streaming}
          placeholder={pending.length > 0 ? 'Ask about this' : 'Ask Hoot anything'}
          hint={false}
          onSend={(text) => fire(host.chat.send({ text }))}
          onStop={() => fire(host.chat.stop())}
          onEmptySend={
            canExplain ? () => fire(host.chat.send({ quickAction: 'explain' })) : undefined
          }
          onFocusChange={onComposerFocus}
          onEmptyChange={onComposerEmpty}
          actions={
            <>
              <VoiceButton voice={voice} controls={talk} />
              <IconButton
                label="Circle anything"
                shortcut={captureShortcut}
                size="sm"
                onClick={() => fire(host.capture.start())}
              >
                <PencilLine />
              </IconButton>
            </>
          }
        />
      </div>
    </section>
  )
}
