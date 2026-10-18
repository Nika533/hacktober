import { Clipboard, Image as ImageIcon, X } from 'lucide-react'
import { Chip } from '../components/Chip'
import { IconButton } from '../components/IconButton'
import { cx } from '../cx'
import { clipboardChipLabel } from './labels'

export interface ClipboardChipProps {
  kind: 'text' | 'image'
  /** Length of the copied text, for the label. */
  chars?: number
  /** Armed chips are included with the next message. It never sends on its own. */
  armed: boolean
  onToggle: () => void
  onDismiss: () => void
  className?: string
}

/** Suggests what was just copied; a toggle the user arms, plus a dismiss. */
export function ClipboardChip({
  kind,
  chars,
  armed,
  onToggle,
  onDismiss,
  className
}: ClipboardChipProps): React.JSX.Element {
  return (
    <div className={cx('hoot-clip-chip', className)}>
      <Chip
        selected={armed}
        icon={kind === 'image' ? <ImageIcon /> : <Clipboard />}
        onClick={onToggle}
      >
        {clipboardChipLabel(kind, chars)}
      </Chip>
      <IconButton
        label="Dismiss clipboard suggestion"
        size="sm"
        tooltip={false}
        onClick={onDismiss}
      >
        <X />
      </IconButton>
    </div>
  )
}
