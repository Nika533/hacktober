import { HootUIProvider } from '@hoot/ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Reply } from '../src/messages'
import { PopupApp, type PopupHost } from '../src/popup/App'
import type { CreateRecognizer, SpeechHandlers } from '../src/popup/speech'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
for (const proto of [Element.prototype, HTMLElement.prototype]) {
  if (Object.hasOwn(proto, 'animate')) delete (proto as { animate?: unknown }).animate
}

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
})

const ok = <T,>(value: T): Reply<T> => ({ ok: true, value })

function fakeHost(over: Partial<PopupHost> = {}): { host: PopupHost; sent: unknown[] } {
  const sent: unknown[] = []
  const host: PopupHost = {
    request: vi.fn(async (message: unknown) => {
      sent.push(message)
      const type = (message as { type: string }).type
      if (type === 'page.current') {
        return ok({ tab: 1, url: 'https://example.com/', title: 'Example page', blocked: null })
      }
      if (type === 'lens.status') return ok({ state: 'connected', appVersion: '1.0.0' })
      return ok(null)
    }) as PopupHost['request'],
    micPermission: vi.fn(async () => 'granted' as PermissionState),
    openMicSetup: vi.fn(),
    close: vi.fn(),
    ...over
  }
  return { host, sent }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- test fixture bag
function scriptedRecognizer() {
  let handlers: SpeechHandlers | null = null
  const started = vi.fn()
  const create: CreateRecognizer = (h) => {
    handlers = h
    return { start: started, stop: () => h.end(), abort: vi.fn() }
  }
  return { create, started, handlers: () => handlers }
}

async function mount(host: PopupHost, recognizer: CreateRecognizer | null): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () =>
    root.render(
      <HootUIProvider>
        <PopupApp host={host} recognizer={recognizer} />
      </HootUIProvider>
    )
  )
  return container
}

const button = (name: string): HTMLButtonElement => {
  const hit = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name
  )
  if (!hit) throw new Error(`no button ${name}`)
  return hit
}

describe('the popup', () => {
  it('shows the page and sends a typed question', async () => {
    const { host, sent } = fakeHost()
    const view = await mount(host, null)
    expect(view.textContent).toContain('Example page')
    expect(view.querySelector('.hoot-popup__mic')).toBeNull()
    const input = view.querySelector('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(input, 'What is this?')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => button('Send to Hoot').click())
    expect(sent).toContainEqual({ type: 'page.ask', text: 'What is this?', voice: false })
    expect(view.textContent).toContain('Hoot’s answer is in its chat')
  })

  it('asks by voice: what was heard goes out as soon as the speaker stops', async () => {
    const { host, sent } = fakeHost()
    const speech = scriptedRecognizer()
    const view = await mount(host, speech.create)
    await act(async () => button('Ask by voice').click())
    expect(speech.started).toHaveBeenCalled()
    await act(async () => speech.handlers()?.heard('summarize this page', true))
    expect(view.querySelector('textarea')?.value).toBe('summarize this page')
    await act(async () => speech.handlers()?.end())
    expect(sent).toContainEqual({ type: 'page.ask', text: 'summarize this page', voice: true })
    expect(view.textContent).toContain('reads it to you')
  })

  it('sends people to the microphone page when the popup may not listen', async () => {
    const { host } = fakeHost({ micPermission: vi.fn(async () => 'prompt' as PermissionState) })
    const speech = scriptedRecognizer()
    await mount(host, speech.create)
    await act(async () => button('Ask by voice').click())
    expect(speech.started).not.toHaveBeenCalled()
    await act(async () => button('Allow the microphone').click())
    expect(host.openMicSetup).toHaveBeenCalled()
  })

  it('says when Hoot isn’t running', async () => {
    const { host } = fakeHost({
      request: vi.fn(async (message: unknown) => {
        const type = (message as { type: string }).type
        if (type === 'lens.status') return ok({ state: 'not_running', appVersion: null })
        if (type === 'page.ask') {
          return { ok: false, error: { code: 'app_unavailable', message: 'x' } }
        }
        return ok(null)
      }) as PopupHost['request']
    })
    const view = await mount(host, null)
    expect(view.textContent).toContain('Hoot isn’t running.')
  })
})
