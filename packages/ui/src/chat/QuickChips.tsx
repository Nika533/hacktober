import { Chip } from '../components/Chip'
import { cx } from '../cx'
import type { QuickAction } from './types'

export interface QuickChipsProps<T extends string> {
  /** In display order; labels come from the prompt catalogue (@hoot/core). */
  actions: readonly QuickAction<T>[]
  onPick: (id: T) => void
  disabled?: boolean
  label?: string
  className?: string
}

/** One-tap prompts for pending captures (Explain, Extract text, …). */
export function QuickChips<T extends string>({
  actions,
  onPick,
  disabled = false,
  label = 'Quick actions',
  className
}: QuickChipsProps<T>): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className={cx('hoot-chip-row', className)}>
      {actions.map((a) => (
        <Chip key={a.id} disabled={disabled} onClick={() => onPick(a.id)}>
          {a.label}
        </Chip>
      ))}
    </div>
  )
}
