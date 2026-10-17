import { motion } from 'motion/react'
import { Maximize2, Pencil, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { AppState } from '../../../shared/types'
import { OWL_SIZE } from '../../../shared/geometry'
import { IconButton } from '../shared/ui/IconButton'
import { Transcript } from '../shared/Transcript'
import { Composer } from '../shared/Composer'
import { AttachmentsRow } from '../shared/AttachmentsRow'
import { QuickChips } from '../shared/QuickChips'
import { ClipboardChip } from '../shared/ClipboardChip'
import { Owl } from '../shared/Owl'

interface Props {
  state: AppState
  exiting: boolean
  seed?: string
  onSeedConsumed(): void
  onOwlPointerDown(e: React.PointerEvent): void
  onOwlPointerMove(e: React.PointerEvent): void
  onOwlPointerUp(e: React.PointerEvent, click: () => void): void
}

const SUGGESTIONS = [
  { label: 'Circle something on screen', run: () => window.hoot.capture.start() },
  {
    label: 'How do I host a Zoom meeting?',
    run: () => window.hoot.ai.send({ text: 'How do I host a Zoom meeting?' })
  },
  {
    label: 'Help me organize data in Excel',
    run: () => window.hoot.ai.send({ text: 'Help me organize data in Excel' })
  }
]

export function Card({
  state,
  exiting,
  seed,
  onSeedConsumed,
  onOwlPointerDown,
  onOwlPointerMove,
  onOwlPointerUp
}: Props): React.JSX.Element {
  const layout = state.buddyLayout!
  const [composerFocused, setComposerFocused] = useState(false)
  const [composerEmpty, setComposerEmpty] = useState(true)

  const owlOnRight = layout.openX === 'left'
  const owlOnBottom = layout.openY === 'up'
  const owlLeft = layout.owl.x - OWL_SIZE / 2
  const owlTop = layout.owl.y - OWL_SIZE / 2

  // Keep content clear of the corner the owl overlaps.
  const sidePad = 52
  const headerPad = owlOnBottom
    ? {}
    : owlOnRight
      ? { paddingRight: sidePad }
      : { paddingLeft: sidePad }
  const composerPad = owlOnBottom
    ? owlOnRight
      ? { paddingRight: sidePad }
      : { paddingLeft: sidePad }
    : {}

  const messages = state.activeSession?.messages ?? []
  const mood = composerFocused && composerEmpty && !state.streaming ? 'listening' : state.mood

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.75, filter: 'blur(8px)' }}
      animate={
        exiting
          ? { opacity: 0, scale: 0.55, filter: 'blur(8px)' }
          : { opacity: 1, scale: 1, filter: 'blur(0px)' }
      }
      transition={{ type: 'spring', bounce: 0, duration: exiting ? 0.26 : 0.35 }}
      style={{
        transformOrigin: `${layout.owl.x}px ${layout.owl.y}px`,
        position: 'absolute',
        inset: 0
      }}
    >
      <div
        className="material-card card"
        style={{ position: 'absolute', inset: 8, display: 'flex', flexDirection: 'column' }}
      >
        <div className="card-header" style={headerPad}>
          <div className="card-title t-title" title={state.activeSession?.title}>
            {state.activeSession?.title ?? 'New chat'}
          </div>
          <div className="card-header-btns">
            <IconButton label="New chat" onClick={() => window.hoot.sessions.new()}>
              <Plus size={16} />
            </IconButton>
            <IconButton label="Unlock into Studio" onClick={() => window.hoot.windows.unlock()}>
              <Maximize2 size={15} />
            </IconButton>
            <IconButton label="Close" onClick={() => window.hoot.buddy.requestMode('pill')}>
              <X size={16} />
            </IconButton>
          </div>
        </div>

        {messages.length === 0 ? (
          state.pendingAttachments.length > 0 ? (
            <div className="card-empty" data-hit>
              <div className="t-greeting">Ask about your capture</div>
              <img
                className="capture-hero"
                src={state.pendingAttachments[state.pendingAttachments.length - 1].thumbDataUrl}
                alt="Latest capture"
              />
            </div>
          ) : (
            <div className="card-empty" data-hit>
              <div className="t-greeting">{state.greeting?.title ?? 'How can I help?'}</div>
              <div className="t-body" style={{ color: 'var(--text-2)' }}>
                Ask me anything, or circle part of your screen.
              </div>
              <div className="chip-col">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    data-hit
                    className="chip t-small"
                    onClick={s.run}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <Transcript
            messages={messages}
            streaming={state.streaming}
            attachments={state.activeSession?.attachments}
          />
        )}

        <AttachmentsRow pending={state.pendingAttachments} />
        {state.pendingAttachments.length > 0 ? <QuickChips /> : null}
        {state.clipboardHint ? <ClipboardChip hint={state.clipboardHint} /> : null}

        <div className="card-composer" style={composerPad}>
          <Composer
            streaming={state.streaming}
            seed={seed}
            autoFocus
            placeholder={state.pendingAttachments.length > 0 ? 'Ask about this…' : 'Ask Hoot…'}
            actions={
              <IconButton label="Circle something" onClick={() => window.hoot.capture.start()}>
                <Pencil size={15} />
              </IconButton>
            }
            onEmptySend={
              state.pendingAttachments.length > 0
                ? () => window.hoot.ai.send({ quickAction: 'explain' })
                : state.clipboardSelection
                  ? () => window.hoot.ai.send({ text: 'Explain this briefly.' })
                  : undefined
            }
            onSend={(text) => {
              onSeedConsumed()
              window.hoot.ai.send({ text })
            }}
            onFocusChange={setComposerFocused}
            onEmptyChange={setComposerEmpty}
          />
        </div>
      </div>

      <div
        data-hit
        className="owl-hit"
        style={{
          position: 'absolute',
          left: owlLeft,
          top: owlTop,
          width: OWL_SIZE,
          height: OWL_SIZE,
          cursor: 'grab'
        }}
        onPointerDown={onOwlPointerDown}
        onPointerMove={onOwlPointerMove}
        onPointerUp={(e) => onOwlPointerUp(e, () => window.hoot.buddy.requestMode('pill'))}
      >
        <Owl mood={mood} />
      </div>
    </motion.div>
  )
}
