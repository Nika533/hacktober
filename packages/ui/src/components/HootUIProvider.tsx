import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { ConfirmProvider } from './ConfirmProvider'
import { ToastProvider } from './Toast'

/**
 * Wrap each window's root once. Gives motion the OS reduced-motion setting
 * (transforms off, opacity kept) and provides useToast() and useConfirm().
 */
export function HootUIProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <MotionConfig reducedMotion="user">
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </MotionConfig>
  )
}
