import { motion } from 'motion/react'
import { Copy, ExternalLink, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAppState, useReducedMotion } from '../shared/hooks'
import { Markdown } from '../shared/Markdown'
import { Owl } from '../shared/Owl'
import { IconButton } from '../shared/ui/IconButton'
import { springMaterialize } from '../shared/springs'

const HEADER_H = 32
// .note-body padding (2 top + 12 bottom) + the card's 1px border on each side
const BODY_CHROME = 2 + 12 + 2

/** One sticky note = one pin. The pin id travels in the URL hash. */
export function NoteApp(): React.JSX.Element | null {
  const pinId = decodeURIComponent(window.location.hash.slice(1))
  const state = useAppState()
  const reduced = useReducedMotion()
  const contentRef = useRef<HTMLDivElement>(null)
  const reported = useRef(0)

  const pin = state?.pins.find((p) => p.id === pinId)
  const sessionTitle = state?.sessions.find((s) => s.id === pin?.sessionId)?.title ?? 'Chat'
  const hasPin = !!pin

  // Report the natural content height; main clamps it to 120–420. Measure the
  // content wrapper, not the flex:1 body (whose height just mirrors the window).
  useEffect(() => {
    const el = contentRef.current
    if (!el || !hasPin) return
    const report = (): void => {
      const h = Math.ceil(HEADER_H + el.offsetHeight + BODY_CHROME)
      if (Math.abs(h - reported.current) > 1) {
        reported.current = h
        window.hoot.pins.resize(h)
      }
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [hasPin])

  if (!pin) return null

  return (
    <motion.div
      className="note-card"
      data-hit
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={reduced ? { duration: 0.15 } : springMaterialize}
    >
      <div className="note-head">
        <Owl mood="idle" size={18} />
        <div className="note-title t-small" title={sessionTitle}>
          {sessionTitle}
        </div>
        <div className="note-head-btns">
          <IconButton
            label="Copy note"
            size={22}
            onClick={() => window.hoot.clipboard.writeText(pin.text)}
          >
            <Copy size={12} />
          </IconButton>
          <IconButton label="Open in Hoot" size={22} onClick={() => window.hoot.pins.openInHoot()}>
            <ExternalLink size={12} />
          </IconButton>
          <IconButton label="Close note" size={22} onClick={() => window.hoot.pins.close()}>
            <X size={12} />
          </IconButton>
        </div>
      </div>
      <div className="note-body">
        {/* flow-root keeps the Markdown's first/last margins inside the measured box */}
        <div ref={contentRef} style={{ display: 'flow-root' }}>
          <Markdown text={pin.text} />
        </div>
      </div>
    </motion.div>
  )
}
