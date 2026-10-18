import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '../cx'

export interface DialogProps {
  open: boolean
  /** Esc, a backdrop click (when dismissible) or the platform closing it. */
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons for the footer, primary first (Windows order). */
  actions?: ReactNode
  /**
   * 'alertdialog' for confirmations that interrupt; it is never dismissed
   * by a backdrop click.
   */
  role?: 'dialog' | 'alertdialog'
  /** Backdrop click closes. Defaults to true for 'dialog'. */
  dismissible?: boolean
  className?: string
}

/**
 * A modal on the native <dialog>: top layer, focus containment, inert
 * background and Esc come from the platform. Focus lands on the element
 * marked data-autofocus, else the first focusable one. Enter and exit run
 * along the same path (scale + fade), CSS-only so no frame waits on JS.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  role = 'dialog',
  dismissible = role === 'dialog',
  className
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)
  const id = useId()
  const titleId = `${id}-title`
  const descId = description ? `${id}-desc` : undefined

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!open && d.open) {
      d.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className={cx('hoot-dialog', className)}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // The platform can still force-close (e.g. a repeated Esc); keep state in sync.
      onClose={() => {
        if (open) onClose()
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (dismissible && pressedBackdrop.current && e.target === e.currentTarget) onClose()
        pressedBackdrop.current = false
      }}
    >
      <div className="hoot-dialog__body">
        <h2 id={titleId} className="hoot-dialog__title">
          {title}
        </h2>
        {description && (
          <p id={descId} className="hoot-dialog__desc">
            {description}
          </p>
        )}
        {children}
      </div>
      {actions && <div className="hoot-dialog__actions">{actions}</div>}
    </dialog>
  )
}
