import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../cx'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Accessible name, also shown as the tooltip. Required: icons alone don't speak. */
  label: string
  /** The icon (e.g. a lucide-react component). */
  children: ReactNode
  variant?: 'ghost' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  /** Displayed in the tooltip, e.g. 'Ctrl+L'. */
  shortcut?: string
  /** Set false where a visible label already sits next to the button. */
  tooltip?: boolean
}

export function IconButton({
  label,
  children,
  variant = 'ghost',
  size = 'md',
  shortcut,
  tooltip = true,
  type = 'button',
  className,
  ...rest
}: IconButtonProps): React.JSX.Element {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cx(
        'hoot-icon-btn',
        variant === 'accent' && 'hoot-icon-btn--accent',
        size !== 'md' && `hoot-icon-btn--${size}`,
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
  return tooltip ? (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}
