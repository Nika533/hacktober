import { motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { springPress } from '../springs'

interface Props {
  label: string
  onClick?: (e: React.MouseEvent) => void
  children: ReactNode
  size?: number
  style?: CSSProperties
  className?: string
  accent?: boolean
}

export function IconButton({
  label,
  onClick,
  children,
  size = 32,
  style,
  className,
  accent
}: Props): React.JSX.Element {
  return (
    <motion.button
      type="button"
      data-hit
      aria-label={label}
      title={label}
      className={`icon-btn ${className ?? ''}`}
      whileTap={{ scale: 0.97 }}
      transition={springPress}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-btn)',
        border: 'none',
        background: accent ? 'var(--accent)' : 'transparent',
        color: accent ? 'var(--on-accent)' : 'var(--text-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flex: '0 0 auto',
        ...style
      }}
    >
      {children}
    </motion.button>
  )
}
