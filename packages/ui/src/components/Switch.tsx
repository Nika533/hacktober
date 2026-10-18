import { useId, type ReactNode } from 'react'
import { cx } from '../cx'

export interface SwitchProps {
  label: ReactNode
  /** Secondary line under the label. */
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * A settings row: label (and description) on the left, the switch on the
 * right. A native checkbox with role="switch" supplies Space-to-toggle and
 * on/off announcements.
 */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className
}: SwitchProps): React.JSX.Element {
  const id = useId()
  const descId = description ? `${id}-desc` : undefined
  return (
    <label className={cx('hoot-switch', className)} data-disabled={disabled || undefined}>
      <span className="hoot-switch__text">
        <span className="hoot-switch__label">{label}</span>
        {description && (
          <span id={descId} className="hoot-switch__desc">
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="hoot-visually-hidden"
        checked={checked}
        disabled={disabled}
        aria-describedby={descId}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className="hoot-switch__track hoot-chrome" aria-hidden>
        <span className="hoot-switch__thumb" />
      </span>
    </label>
  )
}
