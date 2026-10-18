import type { AiErrorCode } from '@hoot/core'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentsRow } from '../src/chat/AttachmentsRow'
import { ClipboardChip } from '../src/chat/ClipboardChip'
import { Composer } from '../src/chat/Composer'
import { describeChatError } from '../src/chat/describeError'
import { clipboardChipLabel } from '../src/chat/labels'
import { Markdown } from '../src/chat/Markdown'
import { QuickChips } from '../src/chat/QuickChips'
import { isAtBottom } from '../src/chat/scroll'
import { Transcript } from '../src/chat/Transcript'
import type { ChatMessageView } from '../src/chat/types'
import { byName, click, render, wait } from './render'

function type(el: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    el.dispatchEvent(e)
  })
  return e
}

describe('describeChatError', () => {
  it('maps every provider code to copy and one fix', () => {
    expect(describeChatError('no_key')).toMatchObject({
      action: 'add-key',
      actionLabel: 'Add API key'
    })
    expect(describeChatError('no_key').message).toBe(
      'Hoot needs a Claude API key before it can answer.'
    )
    expect(describeChatError('auth')).toMatchObject({
      action: 'open-settings',
      message: 'Anthropic rejected the API key. Check it in Settings.'
    })
    for (const c of ['rate_limited', 'busy', 'network'])
      expect(describeChatError(c).action).toBe('retry')
    expect(describeChatError('blocked')).toMatchObject({ action: null, actionLabel: null })
  })

  it('names Claude and Anthropic in the copy', () => {
    expect(describeChatError('rate_limited').message).toBe(
      'Claude’s rate limit was reached. Wait a moment, then retry.'
    )
    expect(describeChatError('busy').message).toBe(
      'Claude is busy right now. Retry in a few seconds.'
    )
    expect(describeChatError('network').message).toBe(
      'Hoot couldn’t reach Claude. Check your connection, then retry.'
    )
    expect(describeChatError('blocked').message).toBe(
      'Claude declined to answer this. Try asking in a different way.'
    )
  })

  it('treats unknown or missing codes as a retryable failure', () => {
    for (const c of [undefined, '', 'teapot', '500']) {
      expect(describeChatError(c)).toMatchObject({ code: 'unknown', action: 'retry' })
    }
  })
})

describe('helpers', () => {
  it('labels the clipboard chip', () => {
    expect(clipboardChipLabel('image')).toBe('Use copied image')
    expect(clipboardChipLabel('text', 1)).toBe('Use copied text (1 character)')
    expect(clipboardChipLabel('text', 1240)).toMatch(/^Use copied text \(1\D?240 characters\)$/)
  })

  it('counts the last 24px as the bottom', () => {
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })).toBe(true)
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 580 })).toBe(true)
    expect(isAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 500 })).toBe(false)
  })
})

describe('Markdown', () => {
  it('renders code blocks with a language label and Copy', async () => {
    const onCopy = vi.fn()
    const { container } = render(
      <Markdown text={'Use this:\n\n```ts\nconst a = 1\n```\n\nand `b`.'} onCopy={onCopy} />
    )
    const block = container.querySelector('.hoot-md-code')!
    expect(block.querySelector('figcaption')?.textContent).toContain('ts')
    expect(block.querySelector('pre')?.getAttribute('tabindex')).toBe('0')
    expect(container.querySelector('.hoot-md-inline')?.textContent).toBe('b')
    click(byName(block, 'button', 'Copy ts'))
    await wait(0)
    expect(onCopy).toHaveBeenCalledWith('const a = 1')
    expect(block.querySelector('button')?.getAttribute('aria-label')).toBe('Copied ts')
  })

  it('never renders raw HTML, unsafe links or remote images', () => {
    const { container } = render(
      <Markdown
        text={
          '<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n' +
          '[bad](javascript:alert(1)) [ok](https://docs.claude.com) ![chart](https://example.com/c.png)'
        }
      />
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    const links = [...container.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      null,
      'https://docs.claude.com',
      'https://example.com/c.png'
    ])
    expect(links[2]?.textContent).toBe('chart')
    expect(links[1]?.rel).toContain('noopener')
  })

  it('hands links to onOpenLink instead of navigating', () => {
    const onOpenLink = vi.fn()
    const { container } = render(
      <Markdown text="[docs](https://docs.claude.com/en/api)" onOpenLink={onOpenLink} />
    )
    const a = container.querySelector('a')!
    const e = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      a.dispatchEvent(e)
    })
    expect(e.defaultPrevented).toBe(true)
    expect(onOpenLink).toHaveBeenCalledWith('https://docs.claude.com/en/api')
  })

  it('wraps GFM tables in a focusable scroller', () => {
    const { container } = render(<Markdown text={'| a | b |\n|---|---|\n| 1 | 2 |'} />)
    const wrap = container.querySelector('.hoot-md-table')!
    expect(wrap.getAttribute('tabindex')).toBe('0')
    expect(wrap.querySelectorAll('td')).toHaveLength(2)
  })
})

const convo: ChatMessageView[] = [
  {
    id: 'u1',
    role: 'user',
    text: 'What is this?',
    status: 'done',
    attachments: [{ id: 'a1', thumbUrl: 'data:image/png;base64,AA==' }]
  },
  { id: 'a1', role: 'assistant', text: 'A **chart**.', status: 'done' },
  { id: 'u2', role: 'user', text: 'Summarize it', status: 'done' },
  { id: 'a2', role: 'assistant', text: 'Revenue grew.', status: 'done' }
]

describe('Transcript', () => {
  it('renders both sides with attachments, and actions on answers', async () => {
    const onCopy = vi.fn()
    const onPin = vi.fn()
    const onRegenerate = vi.fn()
    const { container } = render(
      <Transcript messages={convo} onCopy={onCopy} onPin={onPin} onRegenerate={onRegenerate} />
    )
    const region = container.querySelector('[role="region"]')!
    expect(region.getAttribute('aria-label')).toBe('Conversation')
    const articles = [...container.querySelectorAll('article')]
    expect(articles.map((a) => a.getAttribute('aria-label'))).toEqual([
      'You',
      'Hoot',
      'You',
      'Hoot'
    ])
    expect(articles[0]?.querySelector('img')?.alt).toBe('Capture 1')
    expect(articles[1]?.querySelector('strong')?.textContent).toBe('chart')

    // Regenerate only on the newest answer.
    expect(articles[1]?.querySelector('[aria-label="Regenerate"]')).toBeNull()
    click(articles[3]!.querySelector('[aria-label="Regenerate"]'))
    expect(onRegenerate).toHaveBeenCalledTimes(1)

    click(articles[1]!.querySelector('[aria-label="Copy"]'))
    await wait(0)
    expect(onCopy).toHaveBeenCalledWith('A **chart**.')
    expect(articles[1]!.querySelector('[aria-label="Copied"]')).not.toBeNull()
    click(articles[1]!.querySelector('[aria-label="Pin as note"]'))
    expect(onPin).toHaveBeenCalledWith('a1')
  })

  it('shows thinking while empty and streaming, hides Regenerate, then announces the answer', () => {
    const streaming: ChatMessageView[] = [
      ...convo.slice(0, 3),
      { id: 'a2', role: 'assistant', text: '', status: 'streaming' }
    ]
    const { container, rerender } = render(
      <Transcript messages={streaming} onRegenerate={() => undefined} />
    )
    const last = container.querySelectorAll('article')[3]!
    expect(last.getAttribute('aria-busy')).toBe('true')
    expect(last.textContent).toContain('Hoot is thinking')
    expect(container.querySelector('[aria-label="Regenerate"]')).toBeNull()

    rerender(<Transcript messages={convo} onRegenerate={() => undefined} />)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Hoot answered')
    expect(container.querySelector('[aria-label="Regenerate"]')).not.toBeNull()
  })

  it('turns errors into a message with the right fix', () => {
    const onAddKey = vi.fn()
    const onRetry = vi.fn()
    const failed = (error: AiErrorCode): ChatMessageView[] => [
      convo[0]!,
      { id: 'e', role: 'assistant', text: '', status: 'error', error }
    ]
    const { container, rerender } = render(
      <Transcript messages={failed('no_key')} onAddKey={onAddKey} onRetry={onRetry} />
    )
    click(byName(container, 'button', 'Add API key'))
    expect(onAddKey).toHaveBeenCalledTimes(1)

    rerender(<Transcript messages={failed('busy')} onAddKey={onAddKey} onRetry={onRetry} />)
    expect(container.textContent).toContain('Claude is busy')
    click(byName(container, 'button', 'Retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<Transcript messages={failed('blocked')} onAddKey={onAddKey} onRetry={onRetry} />)
    expect(container.querySelector('.hoot-msg-error button')).toBeNull()
  })

  it('shows the empty state and marks stopped answers', () => {
    const { container, rerender } = render(<Transcript messages={[]} empty={<p>Ask anything</p>} />)
    expect(container.textContent).toContain('Ask anything')
    rerender(
      <Transcript messages={[{ id: 's', role: 'assistant', text: 'Partial', status: 'stopped' }]} />
    )
    expect(container.querySelector('.hoot-msg__note')?.textContent).toBe('Stopped')
  })
})

describe('Composer', () => {
  it('sends trimmed text on Enter and clears; Shift+Enter and IME Enter do not send', () => {
    const onSend = vi.fn()
    const onEmptyChange = vi.fn()
    const { container } = render(<Composer onSend={onSend} onEmptyChange={onEmptyChange} />)
    const ta = container.querySelector('textarea')!
    expect(ta.getAttribute('aria-label')).toBe('Message Hoot')
    const send = byName<HTMLButtonElement>(container, 'button', 'Send')
    expect(send.disabled).toBe(true)

    type(ta, '  Explain this  ')
    expect(onEmptyChange).toHaveBeenLastCalledWith(false)
    expect(send.disabled).toBe(false)
    expect(press(ta, 'Enter', { shiftKey: true }).defaultPrevented).toBe(false)
    press(ta, 'Enter', { isComposing: true })
    expect(onSend).not.toHaveBeenCalled()

    expect(press(ta, 'Enter').defaultPrevented).toBe(true)
    expect(onSend).toHaveBeenCalledWith('Explain this')
    expect(ta.value).toBe('')
    expect(onEmptyChange).toHaveBeenLastCalledWith(true)
  })

  it('allows an empty send only with onEmptySend', () => {
    const onSend = vi.fn()
    const onEmptySend = vi.fn()
    const { container } = render(<Composer onSend={onSend} onEmptySend={onEmptySend} />)
    const send = byName<HTMLButtonElement>(container, 'button', 'Send')
    expect(send.disabled).toBe(false)
    press(container.querySelector('textarea')!, 'Enter')
    expect(onEmptySend).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('swaps Send for Stop while streaming', () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    const { container } = render(
      <Composer onSend={onSend} onStop={onStop} streaming seed="next question" />
    )
    expect(container.querySelector('[aria-label="Send"]')).toBeNull()
    press(container.querySelector('textarea')!, 'Enter')
    expect(onSend).not.toHaveBeenCalled()
    click(byName(container, 'button', 'Stop answering'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})

describe('AttachmentsRow / QuickChips / ClipboardChip', () => {
  it('lists pending captures with labelled remove buttons', () => {
    const onRemove = vi.fn()
    const { container, rerender } = render(<AttachmentsRow attachments={[]} onRemove={onRemove} />)
    expect(container.innerHTML).toBe('')
    rerender(
      <AttachmentsRow
        attachments={[
          { id: 'x', thumbUrl: 'data:,' },
          { id: 'y', thumbUrl: 'data:,', label: 'Chart' }
        ]}
        onRemove={onRemove}
      />
    )
    expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe('Attached captures')
    click(byName(container, 'button', 'Remove Chart'))
    expect(onRemove).toHaveBeenCalledWith('y')
    expect(container.querySelector('img')?.alt).toBe('Capture 1')
  })

  it('picks quick actions by id', () => {
    const onPick = vi.fn()
    const { container } = render(
      <QuickChips
        actions={[
          { id: 'explain', label: 'Explain' },
          { id: 'extract', label: 'Extract text' }
        ]}
        onPick={onPick}
      />
    )
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Quick actions'
    )
    click(byName(container, 'button', 'Extract text'))
    expect(onPick).toHaveBeenCalledWith('extract')
  })

  it('arms and dismisses the clipboard chip', () => {
    const onToggle = vi.fn()
    const onDismiss = vi.fn()
    const { container, rerender } = render(
      <ClipboardChip
        kind="text"
        chars={12}
        armed={false}
        onToggle={onToggle}
        onDismiss={onDismiss}
      />
    )
    const chip = container.querySelector('.hoot-chip')!
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    click(chip)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(
      <ClipboardChip kind="text" chars={12} armed onToggle={onToggle} onDismiss={onDismiss} />
    )
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    click(byName(container, 'button', 'Dismiss clipboard suggestion'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
