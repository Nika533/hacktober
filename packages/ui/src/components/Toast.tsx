import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { springs } from '../motion/springs'
import { IconButton } from './IconButton'
import { ToastContext, type ToastApi, type ToastOptions } from './toastContext'

interface ToastEntry extends ToastOptions {
  id: string
}

export const TOAST_DEFAULT_MS = 5000
const MAX_VISIBLE = 3

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  // Mirror of the list so callbacks can fire onDismiss outside a state updater.
  const listRef = useRef<ToastEntry[]>([])
  const seq = useRef(0)

  const replace = useCallback((next: ToastEntry[]): void => {
    const gone = listRef.current.filter((t) => !next.includes(t))
    listRef.current = next
    setToasts(next)
    for (const t of gone) t.onDismiss?.()
  }, [])

  const dismiss = useCallback(
    (id: string): void => replace(listRef.current.filter((t) => t.id !== id)),
    [replace]
  )

  // The oldest toast makes room when a fourth arrives (its onDismiss still runs).
  const show = useCallback(
    (options: ToastOptions): string => {
      seq.current += 1
      const id = `toast-${seq.current}`
      replace([...listRef.current, { ...options, id }].slice(-MAX_VISIBLE))
      return id
    },
    [replace]
  )

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section aria-label="Notifications" className="hoot-toasts">
        <ol aria-live="polite" aria-relevant="additions text">
          <AnimatePresence initial={false}>
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
            ))}
          </AnimatePresence>
        </ol>
      </section>
    </ToastContext.Provider>
  )
}

function ToastItem({
  toast,
  onDismiss
}: {
  toast: ToastEntry
  onDismiss: () => void
}): React.JSX.Element {
  const duration = toast.duration === undefined ? TOAST_DEFAULT_MS : toast.duration
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(duration ?? 0)
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  // Count down only while nobody is reading or reaching for it.
  const paused = hovered || focused
  useEffect(() => {
    if (duration === null || paused) return
    const started = Date.now()
    const timer = setTimeout(() => dismissRef.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - started
    }
  }, [duration, paused])

  return (
    <motion.li
      layout
      className="hoot-toast hoot-material hoot-material--popover"
      data-tone={toast.tone ?? 'neutral'}
      role={toast.tone === 'danger' ? 'alert' : undefined}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={springs.standard}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDismiss()
        }
      }}
    >
      <span className="hoot-toast__message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="hoot-toast__action"
          onClick={() => {
            toast.action?.onAction()
            onDismiss()
          }}
        >
          {toast.action.label}
        </button>
      )}
      <IconButton label="Dismiss" size="sm" tooltip={false} onClick={onDismiss}>
        <X />
      </IconButton>
    </motion.li>
  )
}
