import { Clipboard, ImageIcon, X } from 'lucide-react'
import type { ClipboardHint } from '../../../shared/types'

/** "Use copied text (N chars)" / "Use copied image" chip above the composer. */
export function ClipboardChip({ hint }: { hint: ClipboardHint }): React.JSX.Element {
  const label =
    hint.kind === 'text' ? `Use copied text (${hint.chars ?? 0} chars)` : 'Use copied image'
  return (
    <div className="clip-chip-row" data-hit>
      <button
        type="button"
        className={`chip t-small clip-chip${hint.selected ? ' selected' : ''}`}
        aria-pressed={!!hint.selected}
        onClick={() => window.hoot.clipboard.arm()}
      >
        {hint.kind === 'image' ? <ImageIcon size={13} /> : <Clipboard size={13} />}
        {label}
      </button>
      <button
        type="button"
        className="clip-dismiss"
        aria-label="Dismiss clipboard suggestion"
        title="Dismiss"
        onClick={() => window.hoot.clipboard.dismiss()}
      >
        <X size={12} />
      </button>
    </div>
  )
}
