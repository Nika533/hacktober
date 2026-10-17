import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from './ui/IconButton'

interface Props {
  streaming: boolean
  seed?: string
  autoFocus?: boolean
  placeholder?: string
  /** Buttons rendered left of the send button (e.g. the capture pencil). */
  actions?: ReactNode
  /** Called when Enter/send is pressed with empty text (e.g. captures pending → explain). */
  onEmptySend?: () => void
  onSend: (text: string) => void
  onFocusChange?: (focused: boolean) => void
  onEmptyChange?: (empty: boolean) => void
}

const MAX_LINES = 6
const LINE_H = 21

export function Composer({
  streaming,
  seed,
  autoFocus,
  placeholder = 'Ask Hoot…',
  actions,
  onEmptySend,
  onSend,
  onFocusChange,
  onEmptyChange
}: Props): React.JSX.Element {
  const [value, setValue] = useState(seed ?? '')
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) ta.current?.focus()
  }, [autoFocus])

  const resize = (): void => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES * LINE_H + 16)}px`
  }

  useEffect(resize, [value])
  useEffect(() => onEmptyChange?.(value.trim().length === 0), [value, onEmptyChange])

  const submit = (): void => {
    const text = value.trim()
    if (streaming) return
    if (!text) {
      onEmptySend?.()
      return
    }
    setValue('')
    onSend(text)
  }

  return (
    <div className="composer" data-hit>
      <textarea
        ref={ta}
        className="composer-input t-body"
        rows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="composer-footer">
        <span className="composer-hint t-small">Enter to send · Shift+Enter for new line</span>
        <div className="composer-footer-right">
          {actions}
          {streaming ? (
            <IconButton label="Stop" accent onClick={() => window.hoot.ai.stop()}>
              <Square size={13} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton label="Send" accent onClick={submit}>
              <ArrowUp size={15} strokeWidth={2.4} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
