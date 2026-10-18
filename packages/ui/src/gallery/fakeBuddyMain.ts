import {
  clampAnchor,
  layoutForMode,
  project,
  QUICK_ACTIONS,
  snapToEdges,
  VOICE_OFF,
  type Attachment,
  type BuddyMode,
  type BuddyTransition,
  type ChatDelta,
  type ClipboardHint,
  type Greeting,
  type HootApi,
  type Message,
  type Point,
  type Rect,
  type Session,
  type StatePatch,
  type StateSlices
} from '@hoot/core'
import { isGrow } from '../buddy/geometry'
import type { BuddyHost } from '../buddy/host'
import { CHART, STREAM_REPLY } from './fixtures'

type Listener<T> = (v: T) => void

function emitter<T>(): { on: (cb: Listener<T>) => () => void; emit: (v: T) => void } {
  const set = new Set<Listener<T>>()
  return {
    on: (cb) => {
      set.add(cb)
      return () => set.delete(cb)
    },
    emit: (v) => {
      for (const cb of [...set]) cb(v)
    }
  }
}

export interface FakeBuddyMainOptions {
  /** The fake screen's work area (the gallery's desktop frame), DIP. */
  workArea: Rect
  anchor: Point
  mode?: BuddyMode
  /** Word interval of the fake stream, ms. */
  streamMs?: number
}

/** What the gallery's Buddy demo drives, besides the `window.hoot` surface. */
export interface FakeBuddyMain {
  /** The Buddy's `window.hoot` (state included, so `useHootState` works on it). */
  hoot: BuddyHost & Pick<HootApi, 'state'>
  requestMode: (mode: BuddyMode) => void
  moveAnchor: (anchor: Point) => void
  greet: (greeting: Greeting) => void
  copy: (hint: ClipboardHint | null) => void
  /** The pointer moved on the fake screen (cursor tracking and drag). */
  pointer: (p: Point) => void
  onHitRegions: (cb: Listener<Rect[]>) => () => void
  onSettle: (cb: Listener<boolean>) => () => void
  /** Transitions sent but not acked yet. */
  unacked: () => number[]
  dispose: () => void
}

/**
 * A stand-in for d1's main process: the buddy mode machine (grow = resize
 * then animate; shrink = animate, ack, then resize), drag with flick and
 * snap, and a streaming chat. Built only on core's contract and geometry.
 */
export function createFakeBuddyMain(opts: FakeBuddyMainOptions): FakeBuddyMain {
  const wa = opts.workArea
  let anchor = opts.anchor
  const mode0 = opts.mode ?? 'dot'
  const slices: Pick<StateSlices, 'buddy' | 'chat' | 'voice'> = {
    voice: VOICE_OFF,
    buddy: {
      mode: mode0,
      layout: layoutForMode(mode0, anchor, wa),
      mood: 'idle',
      greeting: null,
      answerReady: false
    },
    chat: { session: null, stream: null, pendingAttachments: [], clipboardHint: null }
  }
  const patches = emitter<StatePatch>()
  const deltas = emitter<ChatDelta>()
  const transitions = emitter<BuddyTransition>()
  const cursor = emitter<Point>()
  const hits = emitter<Rect[]>()
  const settle = emitter<boolean>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }

  const setBuddy = (p: Partial<StateSlices['buddy']>): void => {
    slices.buddy = { ...slices.buddy, ...p }
    patches.emit({ buddy: slices.buddy })
  }
  const setChat = (p: Partial<StateSlices['chat']>): void => {
    slices.chat = { ...slices.chat, ...p }
    patches.emit({ chat: slices.chat })
  }
  const setVoice = (p: Partial<StateSlices['voice']>): void => {
    slices.voice = { ...slices.voice, ...p }
    patches.emit({ voice: slices.voice })
  }

  // ---- mode machine ----------------------------------------------------------
  let seq = 0
  let pending: { id: number; to: BuddyMode; after?: () => void } | null = null
  const target = (): BuddyMode => pending?.to ?? slices.buddy.mode

  const requestMode = (to: BuddyMode): void => {
    const from = target()
    if (to === from) return
    const id = ++seq
    if (!isGrow(slices.buddy.mode, to)) {
      // Shrink: the renderer animates out in the big window, then main resizes.
      pending = {
        id,
        to,
        after: () =>
          setBuddy({
            mode: to,
            layout: layoutForMode(to, anchor, wa),
            ...(to === 'card' ? { answerReady: false } : {})
          })
      }
    } else {
      // Grow: resize first so the new surface has room, then animate in.
      pending = { id, to }
      setBuddy({
        mode: to,
        layout: layoutForMode(to, anchor, wa),
        ...(to === 'card' ? { answerReady: false } : {})
      })
    }
    transitions.emit({ id, from, to })
  }

  const transitionDone = (id: number): void => {
    if (pending?.id !== id) return
    const p = pending
    pending = null
    p.after?.()
  }

  const moveAnchor = (next: Point): void => {
    anchor = next
    setBuddy({ layout: layoutForMode(slices.buddy.mode, anchor, wa) })
  }

  // ---- drag, flick and snap ------------------------------------------------------
  let lastPointer: Point = anchor
  let grab: { pointer: Point; anchor: Point } | null = null
  let tracking = false
  const pointer = (p: Point): void => {
    lastPointer = p
    if (grab) {
      moveAnchor({
        x: grab.anchor.x + p.x - grab.pointer.x,
        y: grab.anchor.y + p.y - grab.pointer.y
      })
    } else if (tracking && slices.buddy.mode !== 'hidden') {
      cursor.emit({ x: p.x - anchor.x, y: p.y - anchor.y })
    }
  }

  // ---- chat ------------------------------------------------------------------------
  let msgSeq = 0
  let streamTimer: ReturnType<typeof setInterval> | undefined
  const nextId = (p: string): string => `${p}-${++msgSeq}`

  const updateMessage = (id: string, patch: Partial<Message>): void => {
    const s = slices.chat.session
    if (!s) return
    setChat({
      session: {
        ...s,
        messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m))
      }
    })
  }

  const finish = (id: string, status: Message['status']): void => {
    clearInterval(streamTimer)
    streamTimer = undefined
    slices.chat = { ...slices.chat, stream: null }
    updateMessage(id, { status })
    setBuddy({ mood: 'idle', answerReady: status === 'done' && target() !== 'card' })
  }

  const stream = (id: string): void => {
    const s = slices.chat.session
    if (!s) return
    clearInterval(streamTimer)
    setChat({ stream: { sessionId: s.id, messageId: id } })
    setBuddy({ mood: 'thinking' })
    const words = STREAM_REPLY.split(' ')
    let n = 0
    later(500, () => {
      setBuddy({ mood: 'talking' })
      streamTimer = setInterval(() => {
        const cur = slices.chat.session
        const msg = cur?.messages.find((m) => m.id === id)
        if (!cur || !msg || msg.status !== 'streaming') {
          finish(id, 'stopped')
          return
        }
        const delta = (n === 0 ? '' : ' ') + words[n]
        n += 1
        // Mutate, broadcast the delta, patch only at the end (AGENTS.md invariant).
        slices.chat = {
          ...slices.chat,
          session: {
            ...cur,
            messages: cur.messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m))
          }
        }
        deltas.emit({ sessionId: cur.id, messageId: id, delta })
        if (n >= words.length) finish(id, 'done')
      }, opts.streamMs ?? 45)
    })
  }

  const send = (text: string): void => {
    const now = Date.now()
    const prev = slices.chat.session
    const pendingAtt = slices.chat.pendingAttachments
    const session: Session = prev ?? {
      id: nextId('s'),
      title: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      createdAt: now,
      updatedAt: now,
      messages: [],
      attachments: {}
    }
    const user: Message = {
      id: nextId('u'),
      role: 'user',
      text,
      attachmentIds: pendingAtt.map((a) => a.id),
      createdAt: now,
      status: 'done'
    }
    const reply: Message = {
      id: nextId('a'),
      role: 'assistant',
      text: '',
      attachmentIds: [],
      createdAt: now,
      status: 'streaming'
    }
    setChat({
      session: {
        ...session,
        updatedAt: now,
        messages: [...session.messages, user, reply],
        attachments: {
          ...session.attachments,
          ...Object.fromEntries(pendingAtt.map((a) => [a.id, a]))
        }
      },
      pendingAttachments: [],
      clipboardHint: null
    })
    stream(reply.id)
  }

  const resolved = Promise.resolve()
  const hoot: FakeBuddyMain['hoot'] = {
    state: {
      subscribe: () => Promise.resolve({ ...slices }),
      onPatch: patches.on
    },
    chat: {
      send: (p) => {
        if (slices.chat.stream) return resolved
        send(p.text ?? (p.quickAction ? QUICK_ACTIONS[p.quickAction].label : 'Explain this'))
        return resolved
      },
      stop: () => {
        const id = slices.chat.stream?.messageId
        if (id) finish(id, 'stopped')
        return resolved
      },
      regenerate: () => {
        const last = slices.chat.session?.messages.findLast((m) => m.role === 'assistant')
        if (last && !slices.chat.stream) {
          updateMessage(last.id, { text: '', status: 'streaming', error: undefined })
          stream(last.id)
        }
        return resolved
      },
      newChat: () => {
        if (!slices.chat.stream) setChat({ session: null })
        return resolved
      },
      onDelta: deltas.on
    },
    clipboard: {
      writeText: (text) => navigator.clipboard?.writeText(text).catch(() => undefined) ?? resolved,
      arm: () => {
        const h = slices.chat.clipboardHint
        if (h) setChat({ clipboardHint: { ...h, selected: !h.selected } })
        return resolved
      },
      dismiss: () => {
        setChat({ clipboardHint: null })
        return resolved
      }
    },
    attachments: {
      open: () => resolved,
      remove: (id) => {
        setChat({ pendingAttachments: slices.chat.pendingAttachments.filter((a) => a.id !== id) })
        return resolved
      }
    },
    capture: {
      // A pretend capture lands straight away and opens the card.
      start: () => {
        const a: Attachment = {
          id: nextId('cap'),
          kind: 'capture',
          thumbDataUrl: CHART,
          width: 320,
          height: 220,
          createdAt: Date.now()
        }
        setChat({ pendingAttachments: [...slices.chat.pendingAttachments, a].slice(-4) })
        requestMode('card')
        return resolved
      },
      getInit: () => Promise.resolve(null),
      commit: () => resolved,
      cancel: () => resolved,
      click: () => Promise.resolve(true),
      minimize: () => resolved,
      onOpen: () => () => undefined,
      onClosed: () => () => undefined,
      onUserClick: () => () => undefined,
      onRestore: () => () => undefined
    },
    pins: {
      create: () => resolved,
      createFromText: () => resolved,
      resize: () => undefined,
      close: () => resolved,
      openInHoot: () => resolved
    },
    windows: {
      openStudio: () => resolved,
      lockStudio: () => resolved,
      openReader: () => resolved
    },
    app: { openExternal: () => resolved },
    code: {
      apply: () => Promise.resolve({ ok: true, message: null }),
      reveal: () => Promise.resolve({ ok: true, message: null }),
      tagStates: () => Promise.resolve(null),
      onChange: () => () => undefined
    },
    agents: { create: () => Promise.resolve(true) },
    // A scripted voice turn: listen, "hear" a question, send it, then stop.
    voice: {
      start: () => {
        const asked = 'What does this chart show?'
        setVoice({ phase: 'listening', heard: '', level: 0.2, problem: null })
        later(500, () => setVoice({ heard: 'What does this', level: 0.7 }))
        later(1000, () => setVoice({ heard: asked, level: 0.5 }))
        later(1700, () => {
          if (slices.voice.phase !== 'listening') return
          setVoice({ phase: 'thinking', heard: asked, level: 0 })
          send(asked)
          later(2500, () => setVoice(VOICE_OFF))
        })
        return resolved
      },
      finish: () => resolved,
      stop: () => {
        setVoice(VOICE_OFF)
        return resolved
      },
      speak: () => resolved
    },
    buddy: {
      requestMode,
      transitionDone,
      setIgnoreMouse: () => undefined,
      setHitRegions: (rects) => hits.emit(rects),
      dragStart: () => {
        grab = { pointer: lastPointer, anchor }
      },
      dragMove: () => undefined,
      dragEnd: (v) => {
        grab = null
        // Flick: project the release velocity, then snap to a nearby edge.
        const projected = { x: anchor.x + project(v.vx), y: anchor.y + project(v.vy) }
        const landed = snapToEdges(clampAnchor(projected, wa), wa)
        const flick = Math.hypot(v.vx, v.vy) > 300
        settle.emit(flick)
        moveAnchor(landed)
      },
      setCursorTracking: (on) => {
        tracking = on
      },
      dismissGreeting: () => {
        if (slices.buddy.greeting) setBuddy({ greeting: null })
        return resolved
      },
      onTransition: transitions.on,
      onCursor: cursor.on
    }
  }

  return {
    hoot,
    requestMode,
    moveAnchor,
    greet: (greeting) => {
      setBuddy({ greeting })
      requestMode('pill')
    },
    copy: (hint) => setChat({ clipboardHint: hint }),
    pointer,
    onHitRegions: hits.on,
    onSettle: settle.on,
    unacked: () => (pending ? [pending.id] : []),
    dispose: () => {
      clearInterval(streamTimer)
      for (const t of timers) clearTimeout(t)
    }
  }
}
