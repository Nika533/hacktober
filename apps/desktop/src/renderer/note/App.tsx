import '@hoot/ui/styles.css'
import './note.css'
import { DEFAULT_SUBSCRIPTIONS, type HootApi } from '@hoot/core'
import {
  applyAccent,
  applyTheme,
  copyText,
  HootUIProvider,
  IconButton,
  Markdown,
  useHootState
} from '@hoot/ui'
import { useEffect, useRef, useState } from 'react'
import { ChatIcon, CloseIcon, CopyIcon } from './icons'

const SLICES = DEFAULT_SUBSCRIPTIONS.note
/** Main opens each note at note.html#<pin id>. */
const PIN_ID = decodeURIComponent(window.location.hash.slice(1))

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <Note hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

function Note({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element | null {
  const { state } = useHootState(hoot, SLICES)
  const pin = state?.pins?.pins.find((p) => p.id === PIN_ID)
  const system = state?.system
  const ref = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  // The window follows the note's height (main clamps it to 120–420).
  useEffect(() => {
    const el = ref.current
    if (!el || !hoot) return
    const observer = new ResizeObserver(() => hoot.pins.resize(el.getBoundingClientRect().height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hoot, pin])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void hoot?.pins.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoot])

  if (!pin) return null

  const copy = async (): Promise<void> => {
    await (hoot ? hoot.clipboard.writeText(pin.text) : copyText(pin.text))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <article ref={ref} className="note" aria-label="Pinned note">
      <header className="note-header">
        <span className="note-title">Hoot</span>
        <div className="note-actions">
          <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" onClick={() => void copy()}>
            <CopyIcon />
          </IconButton>
          {pin.sessionId ? (
            <IconButton label="Open in Hoot" size="sm" onClick={() => void hoot?.pins.openInHoot()}>
              <ChatIcon />
            </IconButton>
          ) : null}
          <IconButton
            label="Close"
            size="sm"
            shortcut="Esc"
            onClick={() => void hoot?.pins.close()}
          >
            <CloseIcon />
          </IconButton>
        </div>
      </header>
      <div className="note-body">
        <Markdown
          text={pin.text}
          onCopy={(t) => hoot?.clipboard.writeText(t) ?? copyText(t)}
          onOpenLink={(href) => void hoot?.app.openExternal(href)}
        />
      </div>
    </article>
  )
}
