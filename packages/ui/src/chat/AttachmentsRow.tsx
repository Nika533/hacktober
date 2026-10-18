import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from '../cx'
import { springs } from '../motion/springs'
import type { ChatAttachmentView } from './types'

export interface AttachmentsRowProps {
  /** Pending (not yet sent) captures. Renders nothing when empty. */
  attachments: readonly ChatAttachmentView[]
  onRemove: (id: string) => void
  /** Click a thumbnail, e.g. to preview it. */
  onOpen?: (id: string) => void
  label?: string
  className?: string
}

export function AttachmentsRow({
  attachments,
  onRemove,
  onOpen,
  label = 'Attached captures',
  className
}: AttachmentsRowProps): React.JSX.Element | null {
  if (attachments.length === 0) return null
  return (
    <ul aria-label={label} className={cx('hoot-attach-row', className)}>
      <AnimatePresence initial={false}>
        {attachments.map((a, i) => {
          const name = a.label ?? `Capture ${i + 1}`
          const img = <img src={a.thumbUrl} alt={onOpen ? '' : name} draggable={false} />
          return (
            <motion.li
              key={a.id}
              layout
              className="hoot-attach"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={springs.standard}
            >
              {onOpen ? (
                <button
                  type="button"
                  className="hoot-attach__open"
                  aria-label={`Open ${name}`}
                  onClick={() => onOpen(a.id)}
                >
                  {img}
                </button>
              ) : (
                img
              )}
              <button
                type="button"
                className="hoot-attach__remove"
                aria-label={`Remove ${name}`}
                onClick={() => onRemove(a.id)}
              >
                <X aria-hidden />
              </button>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
