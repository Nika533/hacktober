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

  const tipEl = useRef<HTMLDivElement | null>(null)

  /** Places the tip next to the trigger; false when the trigger is off screen. */
  const place = useCallback((): boolean => {
    const tip = tipEl.current
    const trigger = anchorRef.current?.firstElementChild
    if (!tip || !trigger) return false
    const r = trigger.getBoundingClientRect()
    if (r.bottom < 0 || r.top > window.innerHeight) return false
    const p = placeTooltip(
      r,
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      placement
    )
    tip.style.top = `${p.top}px`
    tip.style.left = `${p.left}px`
    tip.dataset.side = p.side
    return true
  }, [placement])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    // Follow the trigger when the page scrolls (Tab scrolls a focused button
    // into view right after the tip opens); hide once it leaves the screen.
    let frame = 0
    const onScroll = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!place()) close()
      })
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close, place])

  // Runs once per mount of the tip: lift it into the top layer and place it.
  const tipRef = useCallback(
    (tip: HTMLDivElement | null): void => {
      tipEl.current = tip
      if (!tip) return
      if (typeof tip.showPopover === 'function') tip.showPopover()
      place()
    },
    [place]
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
