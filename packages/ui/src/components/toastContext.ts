import { createContext, useContext, type ReactNode } from 'react'

export type ToastTone = 'neutral' | 'success' | 'danger'

export interface ToastOptions {
  message: ReactNode
  /** One action, e.g. Undo. Choosing it dismisses the toast. */
  action?: { label: string; onAction: () => void }
  /** 'danger' toasts are announced assertively. */
  tone?: ToastTone
  /** ms before auto-dismiss (paused while hovered or focused); null keeps it up. */
  duration?: number | null
  /** Called however the toast goes away (timeout, close, action, Esc). */
  onDismiss?: () => void
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => string
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast() needs a <HootUIProvider> (or <ToastProvider>) above it')
  return api
}
