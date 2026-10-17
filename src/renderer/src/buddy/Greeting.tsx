import { motion } from 'motion/react'
import type { Greeting as GreetingT } from '../../../shared/types'
import { springMaterialize } from '../shared/springs'

interface Props {
  greeting: GreetingT
  openX: 'left' | 'right'
  openY: 'up' | 'down'
  onDismiss(): void
  onAction?(action: 'continue' | 'clipboard'): void
}

export function Greeting({
  greeting,
  openX,
  openY,
  onDismiss,
  onAction
}: Props): React.JSX.Element {
  const origin = openY === 'up' ? '50% 100%' : '50% 0%'
  return (
    <motion.div
      data-hit
      className={`greeting material-chip ${openY === 'up' ? 'top' : 'bottom'} ${
        openX === 'left' ? 'tail-right' : 'tail-left'
      }`}
      initial={{ opacity: 0, scale: 0.9, filter: 'blur(4px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.92, filter: 'blur(4px)' }}
      transition={springMaterialize}
      style={{ transformOrigin: origin }}
      onClick={() => {
        if (greeting.action) onAction?.(greeting.action)
        onDismiss()
      }}
    >
      <div className="t-greeting">{greeting.title}</div>
      <div className="t-body" style={{ color: 'var(--text-2)' }}>
        {greeting.subtitle}
      </div>
      <div className="greeting-tail" />
    </motion.div>
  )
}
