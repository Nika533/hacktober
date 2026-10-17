import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx'

export interface ChipProps extends ComponentPropsWithRef<'button'> {
  /** Toggle chips set this (renders aria-pressed); action chips leave it undefined. */
  selected?: boolean
  /** Leading icon (decorative). */
  icon?: ReactNode
}

/** A pill-shaped button for suggestions and toggles above the composer. */
export function Chip({
  selected,
  icon,
  type = 'button',
  className,
  children,
  ...rest
}: ChipProps): React.JSX.Element {
  return (
    <button type={type} className={cx('hoot-chip', className)} aria-pressed={selected} {...rest}>
      {icon && (
        <span className="hoot-chip__icon" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </button>
  )
}
