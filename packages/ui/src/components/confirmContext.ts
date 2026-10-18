import { createContext, useContext, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: ReactNode
  body?: ReactNode
  /** Names the action: 'Delete chat', not 'OK'. */
  confirmLabel: string
  cancelLabel?: string
  /** 'danger' paints the confirm button red and focuses Cancel first. */
  tone?: 'default' | 'danger'
}

export type Confirm = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<Confirm | null>(null)

/** The window.confirm replacement: `if (await confirm({...})) …`. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm)
    throw new Error('useConfirm() needs a <HootUIProvider> (or <ConfirmProvider>) above it')
  return confirm
}
