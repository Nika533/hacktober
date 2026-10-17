import { BrowserWindow, app, nativeTheme, systemPreferences } from 'electron'
import path from 'path'
import { IPC } from '../shared/ipc'
import { greetingFor } from '../shared/prompts'
import { getState, initState, onState, updateState } from './store/state'
import { DebouncedWriter, Persistence } from './store/persistence'
import { SecretStore } from './store/secrets'
import { BuddyWindow } from './windows/buddy'
import { OverlayWindow } from './windows/overlay'
import { createStudio, lockStudio, markQuitting, openStudio, studioWindow } from './windows/studio'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { createTray, type TrayHandle } from './tray'
import { registerIpc } from './ipc'
import { exposeTestHooks } from './testHooks'
import { initCapture, startCapture } from './capture'
import { probeClipboard } from './clipboard'
import { decideHint, type ClipboardFingerprint } from '../shared/clipboard'
import { NoteManager } from './windows/note'
import { closePin, initPins } from './pins'
import type { Rect, Session } from '../shared/types'
import type { SendPayload } from '../shared/ipc'

// HOOT_USER_DATA must be applied before anything else, including the
// single-instance lock.
if (process.env.HOOT_USER_DATA) {
  app.setPath('userData', process.env.HOOT_USER_DATA)
}

const IS_TEST = process.env.HOOT_TEST === '1'
const FAKE_AI = process.env.HOOT_FAKE_AI === '1'
const isDev = !!process.env.ELECTRON_RENDERER_URL

app.setAppUserModelId('com.hoot.buddy')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    onSummonHotkey()
  })
}

let buddy: BuddyWindow | null = null
let overlay: OverlayWindow | null = null
let notes: NoteManager | null = null
let sendFn: ((p: SendPayload) => void) | null = null
let persistence: Persistence | null = null
let writer: DebouncedWriter | null = null
/** Fingerprint of the clipboard at boot — pre-existing content is never suggested. */
let lastClipboardFp: ClipboardFingerprint | null = null
let notesHidden = false
let quitting = false

function rendererUrl(page: string): string {
  if (isDev) return `${process.env.ELECTRON_RENDERER_URL}/${page}`
  return path.join(__dirname, `../renderer/${page}`)
}

function summon(): void {
  if (!buddy) return
  const s = getState()
  if (s.buddyMode !== 'hidden') return
  const last = s.sessions[0]
  const recent =
    s.activeSession && s.activeSession.messages.length > 0
      ? { title: s.activeSession.title, updatedAt: s.activeSession.updatedAt }
      : last && Date.now() - last.updatedAt < 2 * 60 * 60 * 1000
        ? { title: last.title, updatedAt: last.updatedAt }
        : undefined
  // Clipboard-aware chip: only suggest content that changed since last check.
  void probeClipboard().then((probe) => {
    const showHint = decideHint(lastClipboardFp, probe, getState().settings.clipboardHint)
    lastClipboardFp = probe?.fp ?? null
    updateState((st) => {
      st.clipboardHint = showHint && probe ? probe.hint : null
      st.clipboardSelection = null
      st.greeting = greetingFor(new Date(), recent, showHint)
    })
    buddy!.summon()
  })
}

/** Buddy-only toggle: summon with greeting, or toggle/hide. */
function toggleBuddy(): void {
  const s = getState()
  if (s.buddyMode === 'hidden') summon()
  else buddy?.toggleSummon()
}

function finishOnboarding(): void {
  updateState((s) => {
    s.settings.onboardingDone = true
    s.studioOpen = false
    s.studioView = 'chat'
    s.onboardingStep = 0
  })
  writer?.schedule('settings', () => persistence!.saveSettings(getState().settings))
  studioWindow()?.hide()
  summon()
}

/** Summon hotkey / second-instance: Studio-aware toggle. */
function onSummonHotkey(): void {
  const s = getState()
  if (s.studioOpen && s.studioView === 'onboarding') {
    // Only the last step ("try it now") finishes on the hotkey.
    if (s.onboardingStep >= 2) finishOnboarding()
    else studioWindow()?.focus()
    return
  }
  const studio = studioWindow()
  if (s.studioOpen && studio?.isVisible()) {
    if (studio.isFocused()) lockStudio()
    else studio.focus()
    return
  }
  toggleBuddy()
}

function broadcastState(): void {
  const state = getState()
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC.stateChanged, state)
  }
}

async function boot(): Promise<void> {
  const root = path.join(app.getPath('userData'), 'hoot')
  persistence = new Persistence(root)
  writer = new DebouncedWriter(300)
  await persistence.ensureDirs()

  const [settings, index, pins, secretStore] = await Promise.all([
    persistence.loadSettings(),
    persistence.loadSessionIndex(),
    persistence.loadPins(),
    Promise.resolve(new SecretStore(persistence.secretPath()))
  ])

  let activeSession: Session | null = null
  if (index.activeId && settings.saveHistory) {
    activeSession = await persistence.loadSession(index.activeId)
  }
  const hasApiKey = (await secretStore.getKey()) !== null

  initState({
    settings,
    sessions: settings.saveHistory ? index.sessions : [],
    activeSession,
    pins,
    hasApiKey,
    accentColor: `#${systemPreferences.getAccentColor()}`,
    darkMode: nativeTheme.shouldUseDarkColors
  })

  // Whatever was already on the clipboard is never suggested.
  void probeClipboard().then((p) => {
    lastClipboardFp = p?.fp ?? null
  })

  onState(() => {
    broadcastState()
    buddy?.refreshCursorTimer()
    buddy?.scheduleCollapse()
  })

  buddy = new BuddyWindow({
    getState,
    update: updateState,
    isDev: () => isDev,
    rendererUrl,
    onDismissGreeting: () =>
      updateState((s) => {
        s.greeting = null
      }),
    onSchedulePersist: () =>
      writer!.schedule('settings', () => persistence!.saveSettings(getState().settings))
  })
  buddy.create()

  createStudio({
    getState,
    update: updateState,
    isDev: () => isDev,
    rendererUrl,
    buddy: () => buddy,
    onPersistBounds: (b: Rect) => {
      updateState((s) => {
        s.settings.studioBounds = b
      })
      writer!.schedule('settings', () => persistence!.saveSettings(getState().settings))
    }
  })

  overlay = new OverlayWindow({ isDev: () => isDev, rendererUrl })
  overlay.create()

  initCapture({
    persistence,
    buddy: () => buddy,
    studio: () => studioWindow(),
    overlay: () => overlay
  })

  notes = new NoteManager({
    isDev: () => isDev,
    isQuitting: () => quitting,
    rendererUrl,
    anchor: () => buddy!.anchor,
    onPinBounds: (id, b) => {
      updateState((s) => {
        const p = s.pins.find((x) => x.id === id)
        if (p) p.bounds = b
      })
      writer!.schedule('pins', () => persistence!.savePins(getState().pins))
    },
    onCloseRequest: (id) => closePin(id)
  })
  initPins({ persistence, writer, notes, buddy: () => buddy })
  if (settings.restorePins) notes.showAll(getState().pins)

  const tray: TrayHandle = createTray({
    onSummon: () => onSummonHotkey(),
    // Clicking the tray always blurs Hoot first, so the focus test can't
    // apply: hidden → summon with greeting, visible → hide.
    onTrayClick: () => {
      if (getState().studioOpen) {
        studioWindow()?.focus()
        return
      }
      if (getState().buddyMode === 'hidden') summon()
      else buddy?.requestMode('hidden')
    },
    onCapture: () => startCapture(),
    onOpenStudio: () => openStudio(),
    onOpenSettings: () => openStudio('settings'),
    onTogglePins: () => {
      notesHidden = !notesHidden
      if (notesHidden) notes?.hideAll()
      else notes?.showAll(getState().pins)
      tray.refresh(getState().pins.length, notesHidden)
    }
  })
  onState(() => tray.refresh(getState().pins.length, notesHidden))

  const reregister = (): void => {
    if (IS_TEST) return
    unregisterHotkeys()
    registerHotkeys(getState().settings, {
      onSummon: () => onSummonHotkey(),
      onCapture: () => startCapture(),
      onErrors: (errors) =>
        updateState((s) => {
          s.hotkeyErrors = errors
        })
    })
  }
  reregister()

  const ipc = registerIpc({
    persistence,
    writer,
    secrets: secretStore,
    buddy,
    fakeAi: FAKE_AI,
    isTest: IS_TEST,
    reregisterHotkeys: reregister,
    onFinishOnboarding: finishOnboarding,
    notes
  })
  sendFn = ipc.send
  app.on('will-quit', () => ipc.dispose())

  systemPreferences.on('accent-color-changed', (_e, color) => {
    updateState((s) => {
      s.accentColor = `#${color}`
    })
  })

  // Electron 44 doesn't propagate themeSource to renderer media queries —
  // push it through the state broadcast instead.
  nativeTheme.on('updated', () => {
    updateState((s) => {
      s.darkMode = nativeTheme.shouldUseDarkColors
    })
  })

  if (IS_TEST) {
    exposeTestHooks({
      buddy,
      summon,
      send: (p) => sendFn?.(p),
      finishOnboarding,
      persistSettings: () =>
        writer!.schedule('settings', () => persistence!.saveSettings(getState().settings))
    })
  }

  // First run → Studio onboarding. Later manual launches show the pill so it's
  // obvious Hoot is running; launch-at-login passes --hidden and stays in the tray.
  if (!settings.onboardingDone) {
    whenLoaded(studioWindow()?.win, () => openStudio('onboarding'))
  } else if (!IS_TEST && !process.argv.includes('--hidden')) {
    whenLoaded(buddy?.win, () => summon())
  }
  const keys = settings.summonHotkey.replace('CommandOrControl', 'Ctrl')
  console.log(`Hoot is running — press ${keys} or click the owl in the tray.`)
}

/** Run `fn` once the window's page has loaded — immediately if it already has. */
function whenLoaded(win: BrowserWindow | null | undefined, fn: () => void): void {
  if (!win || win.isDestroyed()) return
  const run = (): void => void setTimeout(fn, 150)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', run)
  else run()
}

app.whenReady().then(() => {
  void boot()
})

app.on('window-all-closed', () => {
  // Tray-resident app: keep running.
})

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  markQuitting()
  // Hold the quit until debounced writes (settings, pins, index) are on disk.
  e.preventDefault()
  void (writer?.flush() ?? Promise.resolve()).then(() => app.quit())
})

app.on('will-quit', () => {
  unregisterHotkeys()
  void writer?.flush()
})
