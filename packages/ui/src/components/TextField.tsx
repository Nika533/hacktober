import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { cx } from '../cx'

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  label: ReactNode
  /** Keep the label for screen readers only (e.g. a search box with a placeholder). */
  hideLabel?: boolean
  description?: ReactNode
  /** Inline validation message; marks the field invalid. */
  error?: ReactNode
  /** Decorative content before the input (an icon). */
  leading?: ReactNode
  /** Interactive content after the input (a Show button, a status icon). */
  trailing?: ReactNode
  /** Classes for the outer wrapper; the rest of the props land on the <input>. */
  className?: string
}

export function TextField({
  label,
  hideLabel = false,
  description,
  error,
  leading,
  trailing,
  className,
  id,
  type = 'text',
  ...input
}: TextFieldProps): React.JSX.Element {
  const auto = useId()
  const inputId = id ?? auto
  const descId = description ? `${inputId}-desc` : undefined
  const errId = error ? `${inputId}-err` : undefined
  const describedBy = [input['aria-describedby'], descId, errId].filter(Boolean).join(' ')
  return (
    <div className={cx('hoot-field', className)}>
      <label htmlFor={inputId} className={hideLabel ? 'hoot-visually-hidden' : 'hoot-field__label'}>
        {label}
      </label>
      <div className="hoot-field__control" data-invalid={error ? true : undefined}>
        {leading && (
          <span className="hoot-field__adorn" aria-hidden>
            {leading}
          </span>
        )}
        <input
          {...input}
          id={inputId}
          type={type}
          className="hoot-field__input"
          aria-invalid={error ? true : input['aria-invalid']}
          aria-describedby={describedBy || undefined}
        />
        {trailing && <span className="hoot-field__adorn">{trailing}</span>}
      </div>
      {description && (
        <span id={descId} className="hoot-field__desc">
          {description}
        </span>
      )}
      {error && (
        <span id={errId} className="hoot-field__error">
          {error}
        </span>
      )}
    </div>
  )
}
