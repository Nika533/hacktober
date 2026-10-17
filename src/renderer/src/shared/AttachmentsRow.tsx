import { X } from 'lucide-react'
import type { Attachment } from '../../../shared/types'

/** Thumbnails row of pending (not yet sent) captures, each with a remove ×. */
export function AttachmentsRow({ pending }: { pending: Attachment[] }): React.JSX.Element | null {
  if (pending.length === 0) return null
  return (
    <div className="attach-row" data-hit>
      {pending.map((a) => (
        <div key={a.id} className="attach-thumb">
          <img src={a.thumbDataUrl} alt="capture" />
          <button
            type="button"
            data-hit
            aria-label="Remove attachment"
            onClick={() => window.hoot.capture.removeAttachment(a.id)}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
