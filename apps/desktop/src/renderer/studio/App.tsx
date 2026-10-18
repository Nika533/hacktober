import '@hoot/ui/styles.css'
import './studio.css'
import { DEFAULT_SUBSCRIPTIONS, type HootApi, type StudioView } from '@hoot/core'
import {
  applyAccent,
  applyTheme,
  AttachmentsRow,
  ChatPane,
  ClipboardChip,
  formatAccelerator,
  HootUIProvider,
  Owl,
  QUICK_ACTION_CHIPS,
  QuickChips,
  StudioLayout,
  StudioSidebar,
  toAttachmentViews,
  toMessageViews,
  useHootState,
  useToast
} from '@hoot/ui'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const SLICES = DEFAULT_SUBSCRIPTIONS.studio

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <Studio hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

function Studio({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element {
  const { state, error } = useHootState(hoot, SLICES)
  const toast = useToast()
  const searchRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // Every call goes to main; a refusal gets a visible, specific message.
  const run = useCallback(
    (call: (api: HootApi) => Promise<unknown>): void => {
      if (!hoot) return
      call(hoot).catch(() =>
        toast.show({
          tone: 'danger',
          message: 'Hoot didn’t respond to that. Try again, or restart Hoot if it keeps happening.'
        })
      )
    },
    [hoot, toast]
  )

  const system = state?.system
  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  const session = state?.chat?.session ?? null
  useEffect(() => {
    document.title = session?.title ? `${session.title} – Hoot` : 'Hoot'
  }, [session?.title])

  // Studio keyboard map (main owns the global shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const k = e.key.toLowerCase()
      if (k === 'n') run((h) => h.chat.newChat())
      else if (k === 'l') run((h) => h.windows.lockStudio())
      else if (k === 'f') searchRef.current?.focus()
      else if (k === ',') run((h) => h.windows.openStudio('settings'))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  const messages = useMemo(() => toMessageViews(session), [session])
  const chat = state?.chat
  const pending = useMemo(
    () => toAttachmentViews(chat?.pendingAttachments ?? []),
    [chat?.pendingAttachments]
  )

  if (!state?.studio || !state.chat || !state.sessions || !state.settings) {
    return <Connecting failed={error !== null} />
  }

  const view: StudioView = state.studio.view
  const hint = state.chat.clipboardHint
  const settings = state.settings.settings

  return (
    <StudioLayout
      sidebar={
        <StudioSidebar
          sessions={state.sessions.list}
          activeId={session?.id ?? null}
          searchRef={searchRef}
          summonShortcut={formatAccelerator(settings.summonHotkey)}
          onOpen={(id) => run((h) => h.sessions.open(id))}
          onRename={(id, title) => run((h) => h.sessions.rename(id, title))}
          onDelete={(id) => run((h) => h.sessions.delete(id))}
          onUndoDelete={(id) => run((h) => h.sessions.undoDelete(id))}
          onNewChat={() => run((h) => h.chat.newChat())}
          onOpenSettings={() => run((h) => h.windows.openStudio('settings'))}
        />
      }
    >
      {view === 'chat' ? (
        <ChatPane
          title={session?.title ?? null}
          messages={messages}
          streaming={state.chat.stream !== null}
          captureShortcut={formatAccelerator(settings.captureHotkey)}
          composerRef={composerRef}
          onSend={(text) => run((h) => h.chat.send({ text }))}
          onStop={() => run((h) => h.chat.stop())}
          onRegenerate={() => run((h) => h.chat.regenerate())}
          onRetry={() => run((h) => h.chat.regenerate())}
          onNewChat={() => run((h) => h.chat.newChat())}
          onLock={() => run((h) => h.windows.lockStudio())}
          onPin={(id) => run((h) => h.pins.create(id))}
          onCopy={(text) => run((h) => h.clipboard.writeText(text))}
          onOpenLink={(href) => run((h) => h.app.openExternal(href))}
          onAddKey={() => run((h) => h.windows.openStudio('settings'))}
          onOpenSettings={() => run((h) => h.windows.openStudio('settings'))}
          onEmptySend={
            pending.length > 0
              ? () => run((h) => h.chat.send({ quickAction: 'explain' }))
              : undefined
          }
          composerTop={
            <>
              {hint && (
                <ClipboardChip
                  kind={hint.kind}
                  chars={hint.chars}
                  armed={hint.selected === true}
                  onToggle={() => run((h) => h.clipboard.arm())}
                  onDismiss={() => run((h) => h.clipboard.dismiss())}
                />
              )}
              <AttachmentsRow
                attachments={pending}
                onRemove={(id) => run((h) => h.attachments.remove(id))}
                onOpen={(id) => run((h) => h.attachments.open(id))}
              />
              {pending.length > 0 && (
                <QuickChips
                  actions={QUICK_ACTION_CHIPS}
                  disabled={state.chat.stream !== null}
                  onPick={(id) => run((h) => h.chat.send({ quickAction: id }))}
                />
              )}
            </>
          }
        />
      ) : (
        <NotYet view={view} onBack={() => run((h) => h.windows.openStudio('chat'))} />
      )}
    </StudioLayout>
  )
}

/** Before the first state arrives (or if main never answers). */
function Connecting({ failed }: { failed: boolean }): React.JSX.Element {
  return (
    <main className="studio-status">
      <Owl mood={failed ? 'error' : 'thinking'} size={64} />
      {failed ? (
        <>
          <h1>Studio couldn’t reach Hoot</h1>
          <p>The app’s main process didn’t answer. Quit Hoot from the tray and open it again.</p>
        </>
      ) : (
        <p role="status">Opening Studio…</p>
      )}
    </main>
  )
}

const VIEW_NAMES: Record<Exclude<StudioView, 'chat'>, string> = {
  settings: 'Settings',
  onboarding: 'Welcome',
  reading: 'Reading',
  profile: 'What Hoot knows about you',
  glossary: 'My glossary'
}

/** Views that land in later tasks (D3-12, D3-13, D3-20, D3-21). */
function NotYet({
  view,
  onBack
}: {
  view: Exclude<StudioView, 'chat'>
  onBack: () => void
}): React.JSX.Element {
  return (
    <section className="studio-status" aria-labelledby="studio-notyet">
      <h1 id="studio-notyet">{VIEW_NAMES[view]}</h1>
      <p>This page is still being built.</p>
      <button type="button" className="hoot-btn hoot-btn--secondary hoot-btn--md" onClick={onBack}>
        Back to chat
      </button>
    </section>
  )
}
