import { useId, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../cx'

export interface SliderProps {
  label: ReactNode
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Spoken (aria-valuetext) and shown value, e.g. v => `${v}%`. */
  formatValue?: (value: number) => string
  /** Hide the numeric readout when the end labels say enough. */
  showValue?: boolean
  /** Words under each end of the track, e.g. 'Fewer changes' ↔ 'More changes'. */
  minLabel?: ReactNode
  maxLabel?: ReactNode
  disabled?: boolean
  className?: string
}

/** A native range input (keyboard, Page Up/Down and AT for free), restyled. */
export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  formatValue = String,
  showValue = true,
  minLabel,
  maxLabel,
  disabled = false,
  className
}: SliderProps): React.JSX.Element {
  const id = useId()
  const text = formatValue(value)
  const span = max - min
  const fill = span > 0 ? ((Math.min(Math.max(value, min), max) - min) / span) * 100 : 0
  // Dynamic geometry: how much of the track is filled.
  const style = { '--hoot-slider-fill': `${fill}%` } as CSSProperties
  return (
    <div className={cx('hoot-slider', className)} data-disabled={disabled || undefined}>
      <div className="hoot-slider__head">
        <label htmlFor={id} className="hoot-slider__label">
          {label}
        </label>
        {showValue && (
          <output htmlFor={id} className="hoot-slider__value" aria-hidden>
            {text}
          </output>
        )}
      </div>
      <input
        id={id}
        type="range"
        className="hoot-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        style={style}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      />
      {(minLabel || maxLabel) && (
        <div className="hoot-slider__ends" aria-hidden>
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  )
}
