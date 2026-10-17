import { Minimize2, PanelRight, Pencil } from 'lucide-react'
import { useState } from 'react'
import type { AppState } from '../../../shared/types'
import { AttachmentsRow } from '../shared/AttachmentsRow'
import { ClipboardChip } from '../shared/ClipboardChip'
import { Composer } from '../shared/Composer'
import { QuickChips } from '../shared/QuickChips'
import { Transcript } from '../shared/Transcript'
import { IconButton } from '../shared/ui/IconButton'

function EditableTitle({ state }: { state: AppState }): React.JSX.Element {
  const sess = state.activeSession
  const [value, setValue] = useState(sess?.title ?? 'New chat')
  // Re-sync when another session opens or the title changes elsewhere
  // (adjust-state-during-render instead of an effect).
  const key = `${sess?.id}:${sess?.title}`
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setValue(sess?.title ?? 'New chat')
  }

  const commit = (): void => {
    const t = value.trim()
    if (sess && t && t !== sess.title) window.hoot.sessions.rename(sess.id, t)
    else setValue(sess?.title ?? 'New chat')
  }

  return (
    <input
      className="pane-title t-title"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setValue(sess?.title ?? 'New chat')
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function ChatPane({ state }: { state: AppState }): React.JSX.Element {
  const [railOpen, setRailOpen] = useState(false)
  const sess = state.activeSession
  const messages = sess?.messages ?? []
  const captures = Object.values(sess?.attachments ?? {})

  return (
    <main className="pane">
      <header className="pane-header drag">
        <EditableTitle state={state} />
        <div className="pane-header-btns no-drag">
          <IconButton
            label="Toggle captures rail"
            onClick={() => setRailOpen((v) => !v)}
            style={railOpen ? { color: 'var(--accent)' } : undefined}
          >
            <PanelRight size={16} />
          </IconButton>
          <IconButton label="Lock back to Hoot (Ctrl+L)" onClick={() => window.hoot.windows.lock()}>
            <Minimize2 size={16} />
          </IconButton>
        </div>
      </header>

      <div className="chat-body">
        <div className="chat-main">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="t-greeting">{state.greeting?.title ?? 'How can I help?'}</div>
              <div className="t-body" style={{ color: 'var(--text-2)' }}>
                Ask me anything, or circle part of your screen.
              </div>
              <button
                type="button"
                className="chip t-small"
                onClick={() => window.hoot.capture.start()}
              >
                Circle something on screen
              </button>
            </div>
          ) : (
            <div className="chat-transcript">
              <Transcript
                messages={messages}
                streaming={state.streaming}
                attachments={sess?.attachments}
              />
            </div>
          )}
          <div className="chat-bottom">
            <AttachmentsRow pending={state.pendingAttachments} />
            {state.pendingAttachments.length > 0 ? <QuickChips /> : null}
            {state.clipboardHint ? <ClipboardChip hint={state.clipboardHint} /> : null}
            <div className="chat-composer">
              <Composer
                streaming={state.streaming}
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
                onSend={(text) => window.hoot.ai.send({ text })}
              />
            </div>
          </div>
        </div>
        {railOpen && captures.length > 0 ? (
          <aside className="rail">
            <div className="rail-label t-small">Captures</div>
            {captures.map((a) => (
              <button
                key={a.id}
                type="button"
                className="rail-thumb"
                title="Open capture"
                onClick={() => window.hoot.attachments.open(a.id)}
              >
                <img src={a.thumbDataUrl} alt="capture" />
              </button>
            ))}
          </aside>
        ) : null}
      </div>
    </main>
  )
}
