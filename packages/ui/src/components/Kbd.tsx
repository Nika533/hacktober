import { cx } from '../cx'

export interface KbdProps {
  /** 'Ctrl+Shift+Space' or ['Ctrl', 'Shift', 'Space']; each key gets its own cap. */
  keys: string | readonly string[]
  className?: string
}

function splitKeys(keys: string | readonly string[]): string[] {
  if (typeof keys !== 'string') return [...keys]
  return keys
    .replace(/\+\+$/, '+Plus')
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
}

export function Kbd({ keys, className }: KbdProps): React.JSX.Element {
  const parts = splitKeys(keys)
  return (
    <kbd className={cx('hoot-kbd', className)}>
      {parts.map((k, i) => (
        <kbd key={`${k}-${i}`} className="hoot-kbd__key">
          {k}
        </kbd>
      ))}
    </kbd>
  )
}
