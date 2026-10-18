import type { AgentState, HootApi, Session } from '@hoot/core'
import type { CodeTagState } from '@hoot/core/code'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent, type AgentHost } from '../src/agents/Agent'
import { CodeChanges } from '../src/chat/CodeChanges'
import { codeChangesFor } from '../src/chat/codeChangesFor'
import { Owl } from '../src/components/Owl'
import { byName, cleanup, click, render, wait } from './render'

afterEach(cleanup)

const ANSWER = [
  'Line 2 is unfinished.',
  '[[line: src/f.js:2, "Missing operand"]]',
  '[[edit: src/f.js:2, "Add the operand"]]',
  '```js',
  '  return a + 1',
  '```'
].join('\n')

function codeApi(states: CodeTagState[] | null): HootApi['code'] & {
  apply: ReturnType<typeof vi.fn>
} {
  return {
    apply: vi.fn(async () => ({ ok: true, message: 'Changed src/f.js:2.' })),
    reveal: vi.fn(async () => ({ ok: true, message: null })),
    tagStates: vi.fn(async () => states),
    onChange: () => () => undefined
  }
}

describe('CodeChanges', () => {
  it('lists the answer’s changes with Apply, and says what VS Code did', async () => {
    const api = codeApi(['ready', 'ready'])
    const { container } = render(<CodeChanges api={api} messageId="m1" text={ANSWER} ready />)
    await wait(0)
    expect(container.textContent).toContain('In VS Code')
    expect(container.textContent).toContain('Add the operand')
    click(byName(container, 'button', 'Apply this change to src/f.js:2'))
    await wait(0)
    expect(api.apply).toHaveBeenCalledWith('m1', 1)
    expect(container.textContent).toContain('Changed src/f.js:2.')
  })

  it('shows nothing for an answer that didn’t read code', async () => {
    const { container } = render(
      <CodeChanges api={codeApi(null)} messageId="m1" text={ANSWER} ready />
    )
    await wait(0)
    expect(container.textContent).toBe('')
    const plain = codeChangesFor(codeApi(['ready']), {
      messages: [{ id: 'm2', text: 'No code here' }]
    } as Session)('m2')
    expect(plain).toBeNull()
  })
})

describe('Owl tint', () => {
  it('marks an agent’s plumage', () => {
    const { container } = render(<Owl mood="idle" tint="teal" />)
    expect(container.querySelector('.hoot-owl')?.getAttribute('data-tint')).toBe('teal')
  })
})

function agent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 'a1',
    name: 'Pink agent',
    color: 'pink',
    minimized: false,
    answerReady: false,
    session: null,
    stream: null,
    ...over
  }
}

function host(): AgentHost & { agents: Record<string, ReturnType<typeof vi.fn>> } {
  const done = vi.fn(async () => undefined)
  return {
    agents: {
      create: vi.fn(async () => true),
      send: done,
      stop: done,
      regenerate: done,
      minimize: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      dragStart: vi.fn(),
      dragMove: vi.fn(),
      dragEnd: vi.fn()
    },
    clipboard: { writeText: done, arm: done, dismiss: done },
    app: { openExternal: done },
    code: codeApi(null),
    pins: {
      create: done,
      createFromText: done,
      resize: vi.fn(),
      close: done,
      openInHoot: done
    },
    windows: { openStudio: done, lockStudio: done, openReader: done }
  } as unknown as AgentHost & { agents: Record<string, ReturnType<typeof vi.fn>> }
}

describe('Agent window', () => {
  it('the card shows the agent in its colour; Close ends it', () => {
    const h = host()
    const { container } = render(<Agent host={h} agent={agent()} />)
    expect(container.querySelector('.hoot-agent')?.getAttribute('data-color')).toBe('pink')
    expect(container.querySelector('h1')?.textContent).toBe('Pink agent')
    expect(container.querySelector('.hoot-owl')?.getAttribute('data-tint')).toBe('pink')
    click(byName(container, 'button', 'Close Pink agent'))
    expect(h.agents.close).toHaveBeenCalled()
  })

  it('minimized, it is just its owl: a click opens it, a dot says an answer is ready', () => {
    const h = host()
    const { container } = render(
      <Agent host={h} agent={agent({ minimized: true, answerReady: true })} />
    )
    expect(container.querySelector('.hoot-agent-card')).toBeNull()
    const owl = byName(container, 'button', 'Open Pink agent, an answer is ready')
    expect(owl.querySelector('.hoot-owl')?.getAttribute('data-tint')).toBe('pink')
    expect(container.querySelector('.hoot-agent-owl__badge')).not.toBeNull()
    click(owl)
    expect(h.agents.restore).toHaveBeenCalled()
  })
})
