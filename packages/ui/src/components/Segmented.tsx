import { LayoutGroup, motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { cx } from '../cx'
import { springs } from '../motion/springs'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** Secondary text inside the segment, e.g. 'paid tier'. */
  hint?: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group. Visible unless hideLabel is set. */
  label: string
  hideLabel?: boolean
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

/**
 * A single-choice control built on native radio inputs, so Tab-to-selected,
 * arrow-key selection and radio semantics come from the platform. The
 * selection thumb slides with a critically damped spring.
 */
export function Segmented<T extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  size = 'md',
  disabled = false,
  className
}: SegmentedProps<T>): React.JSX.Element {
  const id = useId()
  const labelId = `${id}-label`
  return (
    <div className={cx('hoot-seg-field', className)}>
      <span id={labelId} className={hideLabel ? 'hoot-visually-hidden' : 'hoot-seg-field__label'}>
        {label}
      </span>
      <LayoutGroup id={id}>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-disabled={disabled || undefined}
          className={cx('hoot-seg', size === 'sm' && 'hoot-seg--sm', 'hoot-chrome')}
        >
          {options.map((o) => {
            const checked = o.value === value
            const off = disabled || o.disabled
            return (
              <label
                key={o.value}
                className="hoot-seg__item"
                data-checked={checked || undefined}
                data-disabled={off || undefined}
              >
                <input
                  type="radio"
                  className="hoot-visually-hidden"
                  name={id}
                  value={o.value}
                  checked={checked}
                  disabled={off}
                  onChange={() => onChange(o.value)}
                />
                {checked && (
                  <motion.span
                    layoutId="thumb"
                    className="hoot-seg__thumb"
                    transition={springs.standard}
                    aria-hidden
                  />
                )}
                <span className="hoot-seg__text">{o.label}</span>
                {o.hint && <span className="hoot-seg__hint">{o.hint}</span>}
              </label>
            )
          })}
        </div>
      </LayoutGroup>
    </div>
  )
}
