import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Kbd } from './Kbd'
import { placeTooltip, type Side } from './placeTooltip'

export interface TooltipProps {
  content: ReactNode
  /** Shown as key caps after the text, e.g. 'Ctrl+L'. */
  shortcut?: string
  placement?: Side
  /**
   * Link the tip to the trigger with aria-describedby. Leave it off when the
   * tip only repeats the trigger's accessible name (as IconButton does).
   */
  describe?: boolean
  /** Hover delay in ms. Keyboard focus shows the tip immediately. */
  delay?: number
  /** A single focusable element. */
  children: ReactElement<{ 'aria-describedby'?: string }>
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

/**
 * Hover (after a delay) or keyboard focus (immediately) shows a small label
 * in the top layer, so it also floats above modal dialogs. Esc, scroll,
 * press, blur and pointer-leave hide it. The trigger is wrapped in a
 * display:contents span, so layout is untouched.
 */
export function Tooltip({
  content,
  shortcut,
  placement = 'top',
  describe = false,
  delay = 500,
  children
}: TooltipProps): React.JSX.Element {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const close = useCallback((): void => {
    clearTimeout(timer.current)
    setOpen(false)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  // Runs once per mount of the tip: lift it into the top layer and place it.
  const tipRef = useCallback(
    (tip: HTMLDivElement | null): void => {
      const trigger = anchorRef.current?.firstElementChild
      if (!tip || !trigger) return
      if (typeof tip.showPopover === 'function') tip.showPopover()
      const p = placeTooltip(
        trigger.getBoundingClientRect(),
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        placement
      )
      tip.style.top = `${p.top}px`
      tip.style.left = `${p.left}px`
      tip.dataset.side = p.side
    },
    [placement]
  )

  const trigger = describe
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], tipId].filter(Boolean).join(' ')
      })
    : children

  return (
    <span
      ref={anchorRef}
      className="hoot-tooltip-anchor"
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setOpen(true), delay)
      }}
      onPointerLeave={close}
      onPointerDown={close}
      onFocus={(e) => {
        if (!isFocusVisible(e.target)) return
        clearTimeout(timer.current)
        setOpen(true)
      }}
      onBlur={close}
    >
      {trigger}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            popover="manual"
            role={describe ? 'tooltip' : undefined}
            aria-hidden={describe ? undefined : true}
            className="hoot-tooltip hoot-chrome"
          >
            <span>{content}</span>
            {shortcut && <Kbd keys={shortcut} />}
          </div>,
          document.body
        )}
    </span>
  )
}
