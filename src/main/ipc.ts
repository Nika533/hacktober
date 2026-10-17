import { BrowserWindow, app, ipcMain, shell } from 'electron'
import type { Message, OverlayCommit, Session, SessionMeta, Settings } from '../shared/types'
import { IPC, type RequestedMode, type SendPayload } from '../shared/ipc'
import { QUICK_ACTIONS, SYSTEM_PROMPT, clipboardTextBlock } from '../shared/prompts'
import { getState, sessionMetaOf, updateState } from './store/state'
import type { DebouncedWriter, Persistence } from './store/persistence'
import type { SecretStore } from './store/secrets'
import type { BuddyWindow } from './windows/buddy'
import { buildMessages, titleFrom } from './ai/conversation'
import { createGeminiClient, type AiClient } from './ai/client'
import { mapAiError } from './ai/errors'
import { createFakeClient } from './ai/fake'
import { readImage, readText, writeText } from './clipboard'
import {
  addImageAttachment,
  cancelCapture,
  commitCapture,
  MAX_PENDING,
  overlayInit,
  startCapture
} from './capture'
import { lockStudio, openSettingsWindow, openStudio } from './windows/studio'
import { closePin, createPin, openPinInHoot } from './pins'
import type { NoteManager } from './windows/note'

export interface IpcDeps {
  persistence: Persistence
  writer: DebouncedWriter
  secrets: SecretStore
  buddy: BuddyWindow
  fakeAi: boolean
  isTest: boolean
  reregisterHotkeys(): void
  onFinishOnboarding(): void
  notes: NoteManager
}

// Gemini counts thinking tokens against this cap, so leave headroom.
const MAX_TOKENS = 8192
const DELETE_UNDO_MS = 5000

let abort: AbortController | null = null
let moodTimer: NodeJS.Timeout | null = null

function newSession(): Session {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    attachments: {}
  }
}

function broadcastDelta(sessionId: string, messageId: string, delta: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC.aiDelta, { sessionId, messageId, delta })
  }
}

/** Must be called inside an updateState mutation. */
function upsertMeta(session: Session): void {
  const meta: SessionMeta = sessionMetaOf(session)
  const list = getState().sessions.filter((m) => m.id !== meta.id)
  list.unshift(meta)
  getState().sessions = list
}

function settleMood(mood: 'celebrate' | 'error'): void {
  if (moodTimer) clearTimeout(moodTimer)
  updateState((s) => {
    s.mood = mood
  })
  moodTimer = setTimeout(
    () => {
      updateState((s) => {
        if (s.mood === mood) s.mood = 'idle'
      })
    },
    mood === 'celebrate' ? 1200 : 1500
  )
}

export function registerIpc(deps: IpcDeps): {
  send: (p: SendPayload) => void
  dispose: () => void
} {
  const { persistence, writer, secrets, buddy } = deps

  const persistSettings = (): void => {
    writer.schedule('settings', () => persistence.saveSettings(getState().settings))
  }
  const persistIndex = (): void => {
    writer.schedule('index', () =>
      persistence.saveSessionIndex({
        activeId: getState().activeSession?.id ?? null,
        sessions: getState().sessions
      })
    )
  }
  const persistSession = (session: Session): void => {
    if (!getState().settings.saveHistory) return
    writer.schedule(`session:${session.id}`, () => persistence.saveSession(session))
  }

  // ---------- chat ----------

  async function runStream(session: Session, asst: Message): Promise<void> {
    const finish = (status: Message['status'], error?: string): void => {
      abort = null
      updateState((s) => {
        asst.status = status
        if (error) asst.error = error
        session.updatedAt = Date.now()
        s.streaming = false
        if (status === 'done') {
          // The card on top means the user saw the answer.
          s.answerReady = s.buddyMode !== 'card'
        }
        upsertMeta(session)
      })
      persistSession(session)
      persistIndex()
      if (status === 'done') settleMood('celebrate')
      else if (status === 'error') settleMood('error')
      else
        updateState((s) => {
          s.mood = 'idle'
        })
    }

    try {
      const key = deps.fakeAi ? 'fake' : await secrets.getKey()
      if (!key) {
        finish('error', 'no-key')
        return
      }
      const client: AiClient = deps.fakeAi ? createFakeClient() : createGeminiClient(key)

      // Preload attachment images so buildMessages stays synchronous.
      const imgCache = new Map<string, { base64: string; mediaType: 'image/png' }>()
      const ids = new Set<string>()
      for (const m of session.messages) for (const id of m.attachmentIds) ids.add(id)
      await Promise.all(
        [...ids].map(async (id) => {
          const buf = await persistence.readAttachment(id)
          if (buf) imgCache.set(id, { base64: buf.toString('base64'), mediaType: 'image/png' })
        })
      )
      const messages = buildMessages(session, (id) => {
        return imgCache.get(id) ?? { base64: '', mediaType: 'image/png' }
      })

      abort = new AbortController()
      let firstDelta = true
      await client.stream(
        {
          model: getState().settings.model,
          system: SYSTEM_PROMPT,
          messages,
          maxTokens: MAX_TOKENS,
          signal: abort.signal
        },
        (delta) => {
          // Invariant: a snapshot contains exactly the deltas sent before
          // it — mutate + broadcast the delta before any updateState.
          asst.text += delta
          broadcastDelta(session.id, asst.id, delta)
          if (firstDelta) {
            firstDelta = false
            updateState((s) => {
              s.mood = 'talking'
            })
          }
        }
      )
      if (abort?.signal.aborted) finish('stopped')
      else finish('done')
    } catch (e) {
      const wasAbort = abort?.signal.aborted || (e as { name?: string })?.name === 'AbortError'
      if (wasAbort) finish('stopped')
      else finish('error', mapAiError(e))
    }
  }

  function send(payload: SendPayload): void {
    const s = getState()
    if (s.streaming) return
    sendNow(payload)
  }

  /** Arm the clipboard chip: snapshot the text now (not at send time). */
  function armClipboard(): void {
    void (async () => {
      const s = getState()
      const hint = s.clipboardHint
      if (!hint) return
      if (hint.kind === 'image') {
        if (s.pendingAttachments.length >= MAX_PENDING) return
        const img = await readImage()
        if (!img) return
        const a = await addImageAttachment(img, 'clipboard-image')
        if (a)
          updateState((st) => {
            st.clipboardHint = null
          })
        return
      }
      const text = await readText()
      if (!text || !text.trim()) return
      updateState((st) => {
        st.clipboardSelection = text
        if (st.clipboardHint) st.clipboardHint = { ...st.clipboardHint, selected: true }
      })
    })()
  }

  function sendNow(payload: SendPayload): void {
    const s = getState()
    if (s.streaming) return
    let session = s.activeSession
    if (!session) session = newSession()

    let displayText = payload.text ?? ''
    let sentText: string | undefined
    if (payload.quickAction) {
      const qa = QUICK_ACTIONS[payload.quickAction]
      displayText = qa.label
      sentText = qa.prompt({ translateTo: s.settings.translateTo })
    }
    const clip = s.clipboardSelection
    if (clip) {
      const ask = sentText ?? payload.text ?? 'Explain this briefly.'
      sentText = `${clipboardTextBlock(clip)}\n\n${ask}`
      if (!displayText) displayText = 'Explain this briefly.'
    }

    const now = Date.now()
    const pending = s.pendingAttachments
    const msg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      text: displayText,
      sentText,
      attachmentIds: pending.map((a) => a.id),
      createdAt: now,
      status: 'done'
    }
    for (const a of pending) session.attachments[a.id] = a
    session.messages.push(msg)

    const asst: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      attachmentIds: [],
      createdAt: now,
      status: 'streaming'
    }
    session.messages.push(asst)

    if (session.title === 'New chat') {
      session.title = payload.quickAction
        ? `${QUICK_ACTIONS[payload.quickAction].label} capture`
        : titleFrom(displayText)
    }

    updateState((st) => {
      st.activeSession = session
      st.pendingAttachments = []
      st.streaming = true
      st.mood = 'thinking'
      st.answerReady = false
      st.greeting = null
      st.clipboardSelection = null
      st.clipboardHint = null
      upsertMeta(session)
    })
    persistSession(session)
    persistIndex()
    void runStream(session, asst)
  }

  // ---------- registrations ----------

  ipcMain.handle(IPC.stateGet, () => getState())
  ipcMain.handle(IPC.sessionsSearch, (_e, q: string) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return getState().sessions
    return getState().sessions.filter((m) => m.title.toLowerCase().includes(needle))
  })
  ipcMain.handle(IPC.settingsValidateApiKey, async (_e, key: string) => {
    const client = deps.fakeAi ? createFakeClient() : createGeminiClient(key)
    return client.validateKey(key)
  })

  ipcMain.on(IPC.buddyRequestMode, (_e, mode: RequestedMode) => buddy.requestMode(mode))
  ipcMain.on(IPC.buddyExitDone, () => buddy.exitDone())
  ipcMain.on(IPC.buddySetIgnoreMouse, (_e, ignore: boolean) => buddy.setIgnoreMouse(ignore))
  ipcMain.on(IPC.buddyDragStart, () => buddy.dragStart())
  ipcMain.on(IPC.buddyDragMove, () => buddy.dragMove())
  ipcMain.on(IPC.buddyDragEnd, (_e, v: { vx: number; vy: number }) => buddy.dragEnd(v))
  ipcMain.on(IPC.buddySetCursorTracking, (_e, on: boolean) => buddy.setCursorTracking(on))
  ipcMain.on(IPC.buddyDismissGreeting, () =>
    updateState((s) => {
      s.greeting = null
    })
  )

  ipcMain.on(IPC.aiSend, (_e, p: SendPayload) => send(p))
  ipcMain.on(IPC.aiStop, () => abort?.abort())
  ipcMain.on(IPC.aiRegenerate, () => {
    const s = getState()
    const sess = s.activeSession
    if (!sess || s.streaming) return
    while (sess.messages.length && sess.messages[sess.messages.length - 1].role !== 'user') {
      sess.messages.pop()
    }
    if (!sess.messages.length) return
    const asst: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      attachmentIds: [],
      createdAt: Date.now(),
      status: 'streaming'
    }
    sess.messages.push(asst)
    updateState((st) => {
      st.streaming = true
      st.mood = 'thinking'
      st.answerReady = false
      upsertMeta(sess)
    })
    persistSession(sess)
    void runStream(sess, asst)
  })

  ipcMain.on(IPC.sessionsNew, () => {
    const session = newSession()
    updateState((s) => {
      s.activeSession = session
    })
    persistSession(session)
    persistIndex()
  })
  ipcMain.on(IPC.sessionsOpen, (_e, id: string) => {
    void (async () => {
      const s = getState()
      if (s.activeSession?.id === id) return
      const loaded = await persistence.loadSession(id)
      if (!loaded) return
      updateState((st) => {
        st.activeSession = loaded
      })
      persistIndex()
    })()
  })
  ipcMain.on(IPC.sessionsRename, (_e, id: string, title: string) => {
    void (async () => {
      updateState((s) => {
        const meta = s.sessions.find((m) => m.id === id)
        if (meta) meta.title = title
        if (s.activeSession?.id === id) s.activeSession.title = title
      })
      const sess =
        getState().activeSession?.id === id
          ? getState().activeSession
          : await persistence.loadSession(id)
      if (sess) {
        sess.title = title
        if (getState().settings.saveHistory)
          writer.schedule(`session:${id}`, () => persistence.saveSession(sess))
      }
      persistIndex()
    })()
  })
  // Delete is soft for 5 s so the toast's Undo can restore the session.
  const pendingDeletes = new Map<
    string,
    { meta: SessionMeta; idx: number; wasActive: boolean; timer: NodeJS.Timeout }
  >()

  ipcMain.on(IPC.sessionsDelete, (_e, id: string) => {
    const s = getState()
    const meta = s.sessions.find((m) => m.id === id)
    if (!meta || pendingDeletes.has(id)) return
    const idx = s.sessions.indexOf(meta)
    const wasActive = s.activeSession?.id === id
    updateState((st) => {
      st.sessions = st.sessions.filter((m) => m.id !== id)
      if (st.activeSession?.id === id) st.activeSession = null
    })
    persistIndex()
    const timer = setTimeout(() => {
      pendingDeletes.delete(id)
      void persistence.deleteSessionFile(id)
    }, DELETE_UNDO_MS)
    pendingDeletes.set(id, { meta, idx, wasActive, timer })
  })

  ipcMain.on(IPC.sessionsUndoDelete, (_e, id: string) => {
    const entry = pendingDeletes.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pendingDeletes.delete(id)
    updateState((st) => {
      st.sessions = st.sessions.filter((m) => m.id !== id)
      st.sessions.splice(Math.min(entry.idx, st.sessions.length), 0, entry.meta)
    })
    persistIndex()
    if (entry.wasActive) {
      void persistence.loadSession(id).then((sess) => {
        if (sess)
          updateState((st) => {
            st.activeSession = sess
          })
      })
    }
  })

  ipcMain.on(IPC.sessionsClearAll, () => {
    for (const e of pendingDeletes.values()) clearTimeout(e.timer)
    pendingDeletes.clear()
    updateState((s) => {
      s.sessions = []
      s.activeSession = null
    })
    void persistence.clearSessions()
  })

  ipcMain.on(IPC.windowsUnlock, () => openStudio())
  ipcMain.on(IPC.windowsLock, () => lockStudio())
  ipcMain.on(IPC.windowsOpenSettings, () => openSettingsWindow())
  ipcMain.on(IPC.onboardingFinish, () => deps.onFinishOnboarding())
  ipcMain.on(IPC.onboardingStep, (_e, n: number) =>
    updateState((s) => {
      s.onboardingStep = n
    })
  )

  ipcMain.on(IPC.captureStart, (_e, mode?: 'lasso' | 'rect' | 'full') => startCapture(mode))
  ipcMain.on(IPC.captureRemoveAttachment, (_e, id: string) =>
    updateState((s) => {
      s.pendingAttachments = s.pendingAttachments.filter((a) => a.id !== id)
    })
  )
  ipcMain.handle(IPC.overlayGetInit, () => overlayInit())
  ipcMain.on(IPC.overlayCommit, (_e, p: OverlayCommit) => void commitCapture(p))
  ipcMain.on(IPC.overlayCancel, () => cancelCapture())

  ipcMain.on(IPC.attachmentOpen, (_e, id: string) => {
    void shell.openPath(persistence.attachmentPath(id))
  })

  ipcMain.handle(IPC.appInfo, () => ({ packaged: app.isPackaged, version: app.getVersion() }))
  ipcMain.on(IPC.appOpenExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.on(IPC.clipboardWriteText, (_e, text: string) => void writeText(text))
  ipcMain.on(IPC.clipboardArm, () => armClipboard())
  ipcMain.on(IPC.clipboardDismiss, () =>
    updateState((s) => {
      s.clipboardHint = null
      s.clipboardSelection = null
    })
  )

  ipcMain.on(IPC.pinsCreate, (_e, messageId: string) => {
    createPin(messageId)
  })
  ipcMain.on(IPC.pinsResize, (e, h: number) => deps.notes.resizeFor(e.sender, h))
  ipcMain.on(IPC.pinsClose, (e) => {
    const id = deps.notes.pinIdFor(e.sender)
    if (id) closePin(id)
  })
  ipcMain.on(IPC.pinsOpenInHoot, (e) => {
    const id = deps.notes.pinIdFor(e.sender)
    if (id) openPinInHoot(id)
  })

  ipcMain.on(IPC.settingsUpdate, (_e, p: Partial<Settings>) => {
    const hotkeysChanged = p.summonHotkey !== undefined || p.captureHotkey !== undefined
    updateState((s) => {
      Object.assign(s.settings, p)
    })
    persistSettings()
    if (hotkeysChanged && !deps.isTest) deps.reregisterHotkeys()
    if (p.launchAtLogin !== undefined && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: p.launchAtLogin, args: ['--hidden'] })
    }
  })
  ipcMain.on(IPC.settingsResetAnchor, () => buddy.resetAnchor())
  ipcMain.on(IPC.settingsSetApiKey, (_e, key: string) => {
    void (async () => {
      await secrets.setKey(key)
      updateState((s) => {
        s.hasApiKey = true
      })
    })()
  })
  ipcMain.on(IPC.settingsClearApiKey, () => {
    void (async () => {
      await secrets.clearKey()
      const still = await secrets.getKey()
      updateState((s) => {
        s.hasApiKey = !!still
      })
    })()
  })

  // On quit, hard-delete any sessions still inside their undo window.
  const dispose = (): void => {
    for (const [id, e] of pendingDeletes) {
      clearTimeout(e.timer)
      void persistence.deleteSessionFile(id)
    }
    pendingDeletes.clear()
  }

  return { send, dispose }
}
