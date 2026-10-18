import '@hoot/ui/styles.css'
import './studio.css'
import {
  DEFAULT_SUBSCRIPTIONS,
  type ApiKeyResult,
  type HootApi,
  type HotkeyError,
  type StudioView
} from '@hoot/core'
import {
  applyAccent,
  applyTheme,
  AttachmentsRow,
  ChatPane,
  ClipboardChip,
  formatAccelerator,
  GlossaryPane,
  HootUIProvider,
  OnboardingPane,
  Owl,
  ProfilePane,
  QUICK_ACTION_CHIPS,
  QuickChips,
  ReadingPane,
  SettingsPane,
  StudioLayout,
  StudioSidebar,
  toAttachmentViews,
  toMessageViews,
  useHootState,
  useLensPages,
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
  const shownView = state?.studio?.view
  const lensPages = useLensPages(hoot?.lens, shownView === 'profile' || shownView === 'glossary')

  if (!state?.studio || !state.chat || !state.sessions || !state.settings) {
    return <Connecting failed={error !== null} />
  }

  const view: StudioView = state.studio.view
  const hint = state.chat.clipboardHint
  const settings = state.settings.settings
  const hotkeyErrors = hotkeyErrorsByShortcut(state.settings.hotkeyErrors)
  const saveKey = (key: string): Promise<ApiKeyResult> =>
    hoot ? hoot.settings.setApiKey(key) : Promise.resolve({ ok: false, reason: 'unreachable' })

  // First run fills the window: no sidebar until there's something to put in it.
  if (view === 'onboarding') {
    return (
      <OnboardingPane
        step={state.studio.onboardingStep}
        summonHotkey={settings.summonHotkey}
        captureHotkey={settings.captureHotkey}
        hasApiKey={state.settings.hasApiKey}
        keyStorage={state.settings.keyStorage}
        hotkeyErrors={hotkeyErrors}
        onStep={(step) => run((h) => h.onboarding.setStep(step))}
        onFinish={() => run((h) => h.onboarding.finish())}
        onUpdate={(patch) => run((h) => h.settings.update(patch))}
        onSaveKey={saveKey}
        onOpenLink={(url) => run((h) => h.app.openExternal(url))}
        onRecordingChange={(on) => suspendHotkeys(hoot, on)}
        lens={state.lens}
      />
    )
  }

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
          onOpenReading={() => run((h) => h.windows.openStudio('reading'))}
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
      ) : view === 'settings' ? (
        <SettingsPane
          settings={settings}
          hasApiKey={state.settings.hasApiKey}
          keyStorage={state.settings.keyStorage}
          hotkeyErrors={hotkeyErrors}
          version={state.system?.version}
          onUpdate={(patch) => run((h) => h.settings.update(patch))}
          onSaveKey={saveKey}
          onClearKey={() => (hoot ? hoot.settings.clearApiKey() : Promise.resolve())}
          onClearChats={() => (hoot ? hoot.sessions.clearAll() : Promise.resolve())}
          onResetAnchor={() => (hoot ? hoot.settings.resetAnchor() : Promise.resolve())}
          onOpenLink={(url) => run((h) => h.app.openExternal(url))}
          onRecordingChange={(on) => suspendHotkeys(hoot, on)}
          onBack={() => run((h) => h.windows.openStudio('chat'))}
        />
      ) : view === 'reading' ? (
        <ReadingPane
          lens={settings.lens}
          status={state.lens}
          onUpdate={(lens) => run((h) => h.settings.update({ lens }))}
          onOpenView={(v) => run((h) => h.windows.openStudio(v))}
          onOpenLink={(url) => run((h) => h.app.openExternal(url))}
          onBack={() => run((h) => h.windows.openStudio('chat'))}
        />
      ) : view === 'profile' ? (
        <ProfilePane
          profile={lensPages.profile}
          changes={lensPages.changes}
          failed={lensPages.failed}
          onRetry={lensPages.reload}
          onPatch={lensPages.patch}
          onExport={() => (hoot ? hoot.lens.exportProfile() : Promise.resolve(null))}
          onReset={lensPages.reset}
          onBack={() => run((h) => h.windows.openStudio('reading'))}
        />
      ) : (
        <GlossaryPane
          entries={lensPages.glossary}
          failed={lensPages.failed}
          onRetry={lensPages.reload}
          onPin={(text) => (hoot ? hoot.pins.createFromText(text) : Promise.resolve())}
          onMarkKnown={(term) => lensPages.patch({ terms: { [term]: 'known' } })}
          onBack={() => run((h) => h.windows.openStudio('reading'))}
        />
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

/** Hotkey registration errors, keyed by shortcut (the first one per row wins). */
function hotkeyErrorsByShortcut(
  errors: readonly HotkeyError[]
): Partial<Record<HotkeyError['which'], string>> {
  const out: Partial<Record<HotkeyError['which'], string>> = {}
  for (const { which, message } of errors) out[which] ??= message
  return out
}

/** Pauses global shortcuts while a recorder listens, so Windows hands Studio the keys. */
function suspendHotkeys(hoot: HootApi | undefined, on: boolean): void {
  void hoot?.settings.suspendHotkeys(on).catch(() => undefined)
}
