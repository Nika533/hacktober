import { DEFAULT_SETTINGS, type Message, type Session, type VoiceProblem } from '@hoot/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, initialSlices, type Store } from '../../src/main/store/store'
import {
  VOICE_TIMING,
  createVoiceService,
  type SpeechEngine,
  type SpeechEvent,
  type VoiceService
} from '../../src/main/voice'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/** An engine the test drives: it hears what the test emits and "speaks" until told. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function scriptedEngine(problem: VoiceProblem | null = null) {
  const listeners = new Set<(e: SpeechEvent) => void>()
  const speaking: Array<(done: boolean) => void> = []
  const said: string[] = []
  const emit = (e: SpeechEvent): void => {
    for (const l of [...listeners]) l(e)
  }
  const engine = {
    listen: vi.fn(async () => problem),
    // Like Windows: a cancel stops at once; a finish completes the phrase (the test emits it) first.
    stopListening: vi.fn((finish: boolean) => {
      if (!finish) queueMicrotask(() => emit({ type: 'stopped' }))
    }),
    speak: vi.fn((text: string) => {
      said.push(text)
      return new Promise<boolean>((resolve) => speaking.push(resolve))
    }),
    hush: vi.fn(() => {
      for (const done of speaking.splice(0)) done(false)
    }),
    on: (l: (e: SpeechEvent) => void) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    prewarm: vi.fn(),
    dispose: vi.fn()
  } satisfies SpeechEngine
  return {
    engine,
    emit,
    said,
    /** Every queued utterance finishes. */
    spoken: () => {
      for (const done of speaking.splice(0)) done(true)
    },
    hear: (text: string, peak = 0.4) => {
      emit({ type: 'partial', text, peak })
      emit({ type: 'final', text, confidence: 0.8, peak })
    }
  }
}

const SYSTEM = {
  platform: 'win32' as const,
  version: '1.0.0',
  packaged: false,
  accentColor: '#2f6bd8',
  darkMode: false,
  highContrast: false
}

function makeStore(): Store {
  return createStore(
    initialSlices({
      settings: DEFAULT_SETTINGS,
      hasApiKey: true,
      keyStorage: 'memory',
      system: SYSTEM
    })
  )
}

const message = (
  id: string,
  role: Message['role'],
  text: string,
  status: Message['status'] = 'done'
): Message => ({
  id,
  role,
  text,
  attachmentIds: [],
  createdAt: 0,
  status
})

/** A stand-in for the chat service: a send adds the user turn and a streaming answer. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function fakeChat(store: Store) {
  let n = 0
  const session = (): Session =>
    store.get('chat').session ?? {
      id: 's1',
      title: 'New chat',
      createdAt: 0,
      updatedAt: 0,
      messages: [],
      attachments: {}
    }
  const answer = (text: string, status: Message['status'] = 'streaming'): void => {
    const s = session()
    const id = store.get('chat').stream?.messageId ?? s.messages.at(-1)?.id ?? 'a0'
    store.update('chat', {
      session: {
        ...s,
        messages: s.messages.map((m) => (m.id === id ? { ...m, text, status } : m))
      },
      stream: status === 'streaming' ? { sessionId: s.id, messageId: id } : null
    })
  }
  const send = vi.fn(async (text: string) => {
    const s = session()
    n += 1
    const reply = message(`a${n}`, 'assistant', '', 'streaming')
    store.update('chat', {
      session: { ...s, messages: [...s.messages, message(`u${n}`, 'user', text), reply] },
      stream: { sessionId: s.id, messageId: reply.id }
    })
  })
  const stopAnswer = vi.fn(async () => {
    const stream = store.get('chat').stream
    if (stream)
      answer(session().messages.find((m) => m.id === stream.messageId)?.text ?? '', 'stopped')
  })
  return { send, stopAnswer, answer }
}

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

describe('voice service', () => {
  let store: Store
  let script: ReturnType<typeof scriptedEngine>
  let chat: ReturnType<typeof fakeChat>
  let voice: VoiceService

  const make = (problem: VoiceProblem | null = null): void => {
    script = scriptedEngine(problem)
    chat = fakeChat(store)
    voice = createVoiceService({
      store,
      engine: script.engine,
      send: chat.send,
      stopAnswer: chat.stopAnswer,
      log,
      timing: { readEveryMs: 0 }
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    store = makeStore()
    make()
  })
  afterEach(() => {
    voice.dispose()
    vi.useRealTimers()
  })

  it('listens, sends what it heard after a pause, reads the answer aloud, then listens again', async () => {
    await voice.start()
    expect(store.get('voice').phase).toBe('listening')

    script.emit({ type: 'partial', text: 'what is', peak: 0.4 })
    expect(store.get('voice').heard).toBe('what is')
    script.emit({ type: 'final', text: 'What is this page about', confidence: 0.7, peak: 0.5 })
    expect(chat.send).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    await settle()
    expect(chat.send).toHaveBeenCalledWith('What is this page about')
    expect(store.get('voice').phase).toBe('thinking')

    chat.answer('It explains tides. The moon')
    await settle()
    expect(script.said).toEqual(['It explains tides.'])
    expect(store.get('voice').phase).toBe('speaking')

    chat.answer('It explains tides. The moon pulls the water.', 'done')
    await settle()
    expect(script.said).toEqual(['It explains tides.', 'The moon pulls the water.'])

    script.spoken()
    await settle()
    expect(script.engine.listen).toHaveBeenCalledTimes(2)
    expect(store.get('voice').phase).toBe('listening')
  })

  it('ignores words the recognizer made up from room noise, and ends when nothing is said', async () => {
    await voice.start()
    script.hear('and the', 0.01)
    expect(store.get('voice').heard).toBe('')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.silenceMs)
    expect(store.get('voice')).toMatchObject({ phase: 'off', problem: 'not_heard' })
    expect(chat.send).not.toHaveBeenCalled()
  })

  it('drops a loud phrase the recognizer scored as made up, and keeps listening', async () => {
    await voice.start()
    script.emit({ type: 'partial', text: 'in orlando', peak: 0.14 })
    expect(store.get('voice').heard).toBe('in orlando')
    script.emit({ type: 'final', text: 'It into a total of', confidence: 0, peak: 0.18 })
    expect(store.get('voice')).toMatchObject({ phase: 'listening', heard: '' })
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    expect(chat.send).not.toHaveBeenCalled()
    script.hear('what time is it', 0.4)
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    expect(chat.send).toHaveBeenCalledWith('what time is it')
  })

  it('explains why it can’t start', async () => {
    voice.dispose()
    make('no_microphone')
    await voice.start()
    expect(store.get('voice')).toMatchObject({ phase: 'off', problem: 'no_microphone' })
  })

  it('finish sends at once, letting the phrase in progress complete', async () => {
    await voice.start()
    script.emit({ type: 'partial', text: 'summarize th', peak: 0.5 })
    await voice.finish()
    expect(script.engine.stopListening).toHaveBeenCalledWith(true)
    script.emit({ type: 'final', text: 'summarize this', confidence: 0.8, peak: 0.5 })
    expect(chat.send).not.toHaveBeenCalled()
    script.emit({ type: 'stopped' })
    await settle()
    expect(chat.send).toHaveBeenCalledWith('summarize this')
  })

  it('finish still sends when the engine never says it stopped', async () => {
    await voice.start()
    script.emit({ type: 'partial', text: 'open the settings', peak: 0.5 })
    await voice.finish()
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.finishMs)
    expect(chat.send).toHaveBeenCalledWith('open the settings')
  })

  it('cuts Hoot off when the mic is pressed while it speaks', async () => {
    await voice.start()
    script.hear('hello')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    chat.answer('Hi there. More to come', 'streaming')
    await settle()
    expect(store.get('voice').phase).toBe('speaking')

    await voice.start()
    expect(script.engine.hush).toHaveBeenCalled()
    expect(store.get('voice').phase).toBe('listening')
  })

  it('stop ends the voice chat and stops speaking, but not the answer', async () => {
    await voice.start()
    script.hear('hello')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    chat.answer('Hi there. More', 'streaming')
    await settle()
    await voice.stop()
    expect(script.engine.hush).toHaveBeenCalled()
    expect(store.get('voice')).toMatchObject({ phase: 'off', problem: null })
    expect(chat.stopAnswer).not.toHaveBeenCalled()
  })

  it('stops a running answer before sending the next spoken message', async () => {
    await voice.start()
    script.hear('first')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    chat.answer('Long answer', 'streaming')
    await settle()
    await voice.start()
    script.hear('second')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    await settle()
    expect(chat.stopAnswer).toHaveBeenCalled()
    expect(chat.send).toHaveBeenLastCalledWith('second')
  })

  it('without spoken replies, listens again once the answer is written', async () => {
    store.update('settings', { settings: { ...DEFAULT_SETTINGS, voiceReplies: false } })
    await voice.start()
    script.hear('hello')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    chat.answer('Hi there.', 'done')
    await settle()
    expect(script.engine.speak).not.toHaveBeenCalled()
    expect(script.engine.listen).toHaveBeenCalledTimes(2)
  })

  it('answers a typed message aloud while it listens', async () => {
    await voice.start()
    await chat.send('typed question')
    await settle()
    expect(store.get('voice').phase).toBe('thinking')
    chat.answer('Typed answer.', 'done')
    await settle()
    expect(script.said).toEqual(['Typed answer.'])
  })

  it('reads one message aloud on request, then goes quiet', async () => {
    store.update('chat', {
      session: {
        id: 's1',
        title: 't',
        createdAt: 0,
        updatedAt: 0,
        attachments: {},
        messages: [message('u1', 'user', 'q'), message('a1', 'assistant', '**Bold** answer. Done.')]
      }
    })
    await voice.speak('a1')
    expect(script.said).toEqual(['Bold answer. Done.'])
    script.spoken()
    await settle()
    expect(store.get('voice').phase).toBe('off')
    expect(script.engine.listen).not.toHaveBeenCalled()
  })

  it('reads aloud the answer to a question sent for the user, then keeps listening', async () => {
    await chat.send('from the browser')
    voice.answerAloud()
    expect(store.get('voice').phase).toBe('thinking')
    chat.answer('Browser answer.', 'done')
    await settle()
    expect(script.said).toEqual(['Browser answer.'])
    script.spoken()
    await settle()
    expect(store.get('voice').phase).toBe('listening')
  })

  it('gives up when a send never starts an answer', async () => {
    chat.send.mockImplementation(async () => undefined)
    await voice.start()
    script.hear('hello')
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.pauseMs)
    await vi.advanceTimersByTimeAsync(VOICE_TIMING.answerMs)
    expect(store.get('voice').phase).toBe('off')
  })
})
