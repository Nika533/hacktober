import { ArrowUp, Square } from 'lucide-react'
import { useId, useState, type ReactNode, type Ref } from 'react'
import { IconButton } from '../components/IconButton'
import { cx } from '../cx'

export interface ComposerProps {
  onSend: (text: string) => void
  /** While an answer streams, the send button becomes Stop. */
  streaming?: boolean
  onStop?: () => void
  /**
   * Allows sending with no text (pending captures → "Explain"). Without it,
   * Send is disabled while the box is empty.
   */
  onEmptySend?: () => void
  /** Initial text (e.g. a pre-filled "Explain more" prompt). Remount to reseed. */
  seed?: string
  /** Accessible name of the text box. */
  label?: string
  placeholder?: string
  /** Extra buttons left of Send (e.g. the capture pencil). */
  actions?: ReactNode
  /** Show the "Enter to send" hint under the box. */
  hint?: boolean
  autoFocus?: boolean
  disabled?: boolean
  inputRef?: Ref<HTMLTextAreaElement>
  onFocusChange?: (focused: boolean) => void
  onEmptyChange?: (empty: boolean) => void
  className?: string
}

/**
 * The message box: grows with its text up to six lines (CSS field-sizing),
 * Enter sends, Shift+Enter breaks the line, and IME composition is never
 * interrupted by Enter.
 */
export function Composer({
  onSend,
  streaming = false,
  onStop,
  onEmptySend,
  seed = '',
  label = 'Message Hoot',
  placeholder = 'Ask Hoot anything',
  actions,
  hint = true,
  autoFocus,
  disabled = false,
  inputRef,
  onFocusChange,
  onEmptyChange,
  className
}: ComposerProps): React.JSX.Element {
  const [value, setValue] = useState(seed)
  const hintId = useId()
  const empty = value.trim().length === 0
  const canSend = !disabled && !streaming && (!empty || onEmptySend !== undefined)

  const update = (next: string): void => {
    const wasEmpty = value.trim().length === 0
    const isEmpty = next.trim().length === 0
    setValue(next)
    if (wasEmpty !== isEmpty) onEmptyChange?.(isEmpty)
  }

  const submit = (): void => {
    if (!canSend) return
    const text = value.trim()
    if (!text) {
      onEmptySend?.()
      return
    }
    update('')
    onSend(text)
  }

  return (
    <div className={cx('hoot-composer', className)} data-disabled={disabled || undefined}>
      <textarea
        ref={inputRef}
        className="hoot-composer__input"
        rows={1}
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => update(e.currentTarget.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          submit()
        }}
      />
      <div className="hoot-composer__footer">
        {hint ? (
          <span id={hintId} className="hoot-composer__hint hoot-chrome">
            Enter to send, Shift+Enter for a new line
          </span>
        ) : (
          <span />
        )}
        <div className="hoot-composer__actions">
          {actions}
          {streaming ? (
            <IconButton
              label="Stop answering"
              variant="accent"
              size="sm"
              className="hoot-composer__stop"
              onClick={onStop}
            >
              <Square fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton
              label="Send"
              shortcut="Enter"
              variant="accent"
              size="sm"
              disabled={!canSend}
              onClick={submit}
            >
              <ArrowUp strokeWidth={2.4} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
