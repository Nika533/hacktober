import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { ConfirmContext, type ConfirmOptions } from './confirmContext'
import { Dialog } from './Dialog'

export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // Options outlive `open` so the dialog keeps its content while it exits.
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean): void => {
    resolver.current?.(ok)
    resolver.current = null
    setOpen(false)
  }, [])

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    resolver.current?.(false)
    setOptions(next)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const danger = options?.tone === 'danger'
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onClose={() => settle(false)}
        role="alertdialog"
        title={options?.title}
        description={options?.body}
        actions={
          <>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => settle(true)}
              data-autofocus={danger ? undefined : true}
            >
              {options?.confirmLabel}
            </Button>
            <Button onClick={() => settle(false)} data-autofocus={danger ? true : undefined}>
              {options?.cancelLabel ?? 'Cancel'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  )
}
