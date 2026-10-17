import { motion } from 'motion/react'
import { MessageCircle, Pencil } from 'lucide-react'
import type { AppState } from '../../../shared/types'
import { IconButton } from '../shared/ui/IconButton'
import { Owl } from '../shared/Owl'
import { PILL_CAPSULE, OWL_SIZE } from '../../../shared/geometry'
import { Greeting } from './Greeting'

interface Props {
  state: AppState
  exiting: boolean
  composerFocused: boolean
  onOwlPointerDown(e: React.PointerEvent): void
  onOwlPointerMove(e: React.PointerEvent): void
  onOwlPointerUp(e: React.PointerEvent, click: () => void): void
  onGreetingAction(action: 'continue' | 'clipboard'): void
}

/** The 164×64 capsule: [owl · pencil · chat], owl inset 4 DIP into the anchor-side end. */
export function Pill({
  state,
  exiting,
  composerFocused,
  onOwlPointerDown,
  onOwlPointerMove,
  onOwlPointerUp,
  onGreetingAction
}: Props): React.JSX.Element {
  const layout = state.buddyLayout!
  const owlOnRight = layout.openX === 'left'

  const owlLeft = layout.owl.x - OWL_SIZE / 2
  const owlTop = layout.owl.y - OWL_SIZE / 2
  // Capsule hugs the owl: 4 DIP inset on the owl's three outer sides.
  const capsuleTop = owlTop - 4
  const capsuleLeft = owlOnRight ? owlLeft + OWL_SIZE + 4 - PILL_CAPSULE.width : owlLeft - 4

  // Button row occupies the non-owl end of the capsule (capsule-relative).
  // owl rel span is [4,60) when on the left, [104,160) when on the right.
  const btnZone = owlOnRight ? { left: 12, width: 88 } : { left: 64, width: 88 }

  return (
    <motion.div
      className="pill-root"
      initial={{ opacity: 0, scale: 0.5, filter: 'blur(6px)' }}
      animate={
        exiting
          ? { opacity: 0, scale: 0.5, filter: 'blur(6px)' }
          : { opacity: 1, scale: 1, filter: 'blur(0px)' }
      }
      transition={{ type: 'spring', bounce: 0, duration: exiting ? 0.26 : 0.35 }}
      style={{
        transformOrigin: `${layout.owl.x}px ${layout.owl.y}px`,
        position: 'absolute',
        inset: 0
      }}
    >
      {state.greeting && !exiting ? (
        <Greeting
          greeting={state.greeting}
          openX={layout.openX}
          openY={layout.openY}
          onDismiss={() => window.hoot.buddy.dismissGreeting()}
          onAction={onGreetingAction}
        />
      ) : null}

      <div
        className="material-pill"
        style={{
          position: 'absolute',
          left: capsuleLeft,
          top: capsuleTop,
          width: PILL_CAPSULE.width,
          height: PILL_CAPSULE.height
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: btnZone.left,
            width: btnZone.width,
            top: 0,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4
          }}
        >
          <IconButton label="Circle something" onClick={() => window.hoot.capture.start()}>
            <Pencil size={17} />
          </IconButton>
          <IconButton label="Chat" onClick={() => window.hoot.buddy.requestMode('card')}>
            <MessageCircle size={17} />
          </IconButton>
        </div>
      </div>

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
        onPointerDown={onOwlPointerDown}
        onPointerMove={onOwlPointerMove}
        onPointerUp={(e) => onOwlPointerUp(e, () => window.hoot.buddy.requestMode('card'))}
      >
        <Owl mood={composerFocused ? 'listening' : state.mood} />
      </div>
    </motion.div>
  )
}
