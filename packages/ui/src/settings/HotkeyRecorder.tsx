import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Kbd } from '../components/Kbd'
import { cx } from '../cx'
import {
  acceleratorFromEvent,
  acceleratorKeys,
  formatAccelerator,
  heldModifiers,
  isModifierKey
} from './accelerator'

export interface HotkeyRecorderProps {
  /** What the shortcut does, e.g. 'Summon Hoot'. */
  label: string
  description?: ReactNode
  /** Electron accelerator, e.g. 'CommandOrControl+Shift+Space'. */
  value: string
  onChange: (accelerator: string) => void
  /** Enables Reset when the value differs from it. */
  defaultValue?: string
  /**
   * Reject a combination before it is saved (e.g. it's Hoot's other
   * shortcut). Return the reason to show, or null to accept.
   */
  validate?: (accelerator: string) => string | null
  /** A problem reported after saving, e.g. "Another app already uses Ctrl+Shift+Space." */
  error?: ReactNode
  /**
   * Recording started or stopped. Main should pause Hoot's global shortcuts
   * meanwhile: the OS hands registered combinations to their owner, so the
   * window would never see them.
   */
  onRecordingChange?: (recording: boolean) => void
  disabled?: boolean
  className?: string
}

const START = 'Recording. Press the new shortcut, or Escape to cancel.'
const NEEDS_MODIFIER = 'Hold Ctrl or Alt (Shift is optional), then press a key.'

/**
 * A settings row that records a global shortcut. Works with the keyboard
 * alone (Enter or Space starts, Escape cancels, Tab leaves without trapping
 * focus) and talks to screen readers through a polite live region: start,
 * rejection and the saved shortcut are each announced once.
 */
export function HotkeyRecorder({
  label,
  description,
  value,
  onChange,
  defaultValue,
  validate,
  error,
  onRecordingChange,
  disabled = false,
  className
}: HotkeyRecorderProps): React.JSX.Element {
  const id = useId()
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef<HTMLSpanElement>(null)

  const say = (text: string): void => {
    const el = live.current
    if (el) el.textContent = el.textContent === text ? `${text}\u00a0` : text
  }

  const setRec = (on: boolean): void => {
    setRecording(on)
    setPreview([])
    onRecordingChange?.(on)
  }

  const start = (): void => {
    if (disabled || recording) return
    setProblem(null)
    setRec(true)
    say(START)
  }

  const cancel = (announce: boolean): void => {
    if (!recording) return
    setRec(false)
    setProblem(null)
    if (announce) say(`Shortcut unchanged: ${formatAccelerator(value)}`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (!recording) return
    const bare = !e.ctrlKey && !e.altKey && !e.metaKey
    if (e.key === 'Tab' && bare) {
      cancel(false) // let focus move on: never a keyboard trap
      return
    }
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape' && bare && !e.shiftKey) {
      cancel(true)
      return
    }
    if (isModifierKey(e.key)) {
      setPreview(heldModifiers(e))
      return
    }
    const acc = acceleratorFromEvent(e)
    if (!acc) {
      setProblem(NEEDS_MODIFIER)
      say(NEEDS_MODIFIER)
      return
    }
    const reason = validate?.(acc) ?? null
    if (reason) {
      setProblem(reason)
      say(reason)
      setPreview([])
      return
    }
    setRec(false)
    setProblem(null)
    if (acc !== value) onChange(acc)
    say(`${label} shortcut set to ${formatAccelerator(acc)}`)
  }

  const shownError = problem ?? (recording ? null : error)
  const ids = {
    label: `${id}-label`,
    value: `${id}-value`,
    desc: `${id}-desc`,
    hint: `${id}-hint`,
    err: `${id}-err`
  }
  const describedBy = [description && ids.desc, ids.hint, shownError && ids.err]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cx('hoot-hotkey', className)}
      data-disabled={disabled || undefined}
      data-invalid={shownError ? true : undefined}
    >
      <div className="hoot-hotkey__text">
        <span id={ids.label} className="hoot-hotkey__label">
          {label}
        </span>
        {description && (
          <span id={ids.desc} className="hoot-hotkey__desc">
            {description}
          </span>
        )}
      </div>
      <div className="hoot-hotkey__controls">
        <button
          type="button"
          className="hoot-hotkey__field hoot-chrome"
          data-recording={recording || undefined}
          aria-labelledby={`${ids.label} ${ids.value}`}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={start}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (recording) setPreview(heldModifiers(e))
          }}
          onBlur={() => cancel(false)}
        >
          {recording ? (
            preview.length > 0 ? (
              <Kbd keys={[...preview, '…']} />
            ) : (
              <span className="hoot-hotkey__prompt">Press a shortcut</span>
            )
          ) : (
            <Kbd keys={acceleratorKeys(value)} />
          )}
          <span id={ids.value} className="hoot-visually-hidden">
            {recording ? 'recording' : formatAccelerator(value)}
          </span>
        </button>
        {/* Always laid out so fields in a list line up; visibility-hidden
            (out of the tab order and a11y tree) when there's nothing to reset. */}
        {defaultValue && (
          <Button
            size="sm"
            variant="ghost"
            className="hoot-hotkey__reset"
            data-hidden={value === defaultValue || recording || undefined}
            disabled={disabled}
            onClick={() => onChange(defaultValue)}
          >
            Reset
          </Button>
        )}
      </div>
      <span id={ids.hint} className="hoot-visually-hidden">
        {recording ? START : 'Press Enter to change it.'}
      </span>
      {shownError && (
        <p id={ids.err} className="hoot-hotkey__error">
          {shownError}
        </p>
      )}
      <span ref={live} className="hoot-visually-hidden" aria-live="polite" />
    </div>
  )
}
