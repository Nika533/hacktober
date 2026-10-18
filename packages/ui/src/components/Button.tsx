import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  /** Leading icon (decorative; the label carries the meaning). */
  icon?: ReactNode
  /** Shows a spinner, sets aria-busy and blocks clicks while work runs. */
  busy?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  type = 'button',
  className,
  disabled,
  children,
  onClick,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cx('hoot-btn', `hoot-btn--${variant}`, `hoot-btn--${size}`, className)}
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {busy ? (
        <span className="hoot-spinner" aria-hidden />
      ) : (
        icon && (
          <span className="hoot-btn__icon" aria-hidden>
            {icon}
          </span>
        )
      )}
      {children}
    </button>
  )
}
