import { motion } from 'motion/react'
import type { AppState } from '../../../shared/types'
import { OWL_SIZE } from '../../../shared/geometry'
import { Owl } from '../shared/Owl'

interface Props {
  state: AppState
  exiting: boolean
  onOwlPointerDown(e: React.PointerEvent): void
  onOwlPointerMove(e: React.PointerEvent): void
  onOwlPointerUp(e: React.PointerEvent, click: () => void): void
}

export function Dot({
  state,
  exiting,
  onOwlPointerDown,
  onOwlPointerMove,
  onOwlPointerUp
}: Props): React.JSX.Element {
  const layout = state.buddyLayout!
  const owlLeft = layout.owl.x - OWL_SIZE / 2
  const owlTop = layout.owl.y - OWL_SIZE / 2
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, filter: 'blur(4px)' }}
      animate={
        exiting
          ? { opacity: 0, scale: 0.6, filter: 'blur(4px)' }
          : { opacity: 1, scale: 1, filter: 'blur(0px)' }
      }
      transition={{ type: 'spring', bounce: 0, duration: exiting ? 0.26 : 0.35 }}
      style={{
        transformOrigin: `${layout.owl.x}px ${layout.owl.y}px`,
        position: 'absolute',
        inset: 0
      }}
    >
      {state.answerReady ? (
        <span className="ready-badge" style={{ left: owlLeft + OWL_SIZE - 14, top: owlTop - 2 }} />
      ) : null}
      <div
        data-hit
        className="owl-hit"
        style={{
          position: 'absolute',
          left: owlLeft,
          top: owlTop,
          width: OWL_SIZE,
          height: OWL_SIZE,
          cursor: 'grab'
        }}
        onPointerEnter={() => window.hoot.buddy.requestMode('pill')}
        onPointerDown={onOwlPointerDown}
        onPointerMove={onOwlPointerMove}
        onPointerUp={(e) => onOwlPointerUp(e, () => window.hoot.buddy.requestMode('pill'))}
      >
        <Owl mood={state.mood} />
      </div>
    </motion.div>
  )
}
