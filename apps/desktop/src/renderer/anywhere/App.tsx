import '@hoot/ui/styles.css'
import './anywhere.css'
import {
  DEFAULT_SUBSCRIPTIONS,
  TRANSFORM_RULES,
  type AnywhereAction,
  type AnywhereState,
  type HootApi
} from '@hoot/core'
import { applyAccent, applyTheme, HootUIProvider, useHootState } from '@hoot/ui'
import {
  BookOpen,
  Check,
  Copy,
  MessagesSquare,
  Pin,
  RotateCw,
  Settings,
  Sparkles,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const SLICES = DEFAULT_SUBSCRIPTIONS.anywhere
/** The bubble closes itself after this long without the pointer over it. */
const IDLE_MS = 45_000

const ERROR_ACTIONS = {
  settings: { label: 'Open settings', icon: <Settings aria-hidden="true" /> },
  reading: { label: 'Open Reading', icon: <BookOpen aria-hidden="true" /> },
  retry: { label: 'Try again', icon: <RotateCw aria-hidden="true" /> }
}

export function App(): React.JSX.Element {
  return (
    <HootUIProvider>
      <Bubble hoot={typeof window.hoot === 'object' ? window.hoot : undefined} />
    </HootUIProvider>
  )
}

/** The bubble's state: pulled once on mount, then every push from main. */
function useAnywhere(hoot: HootApi | undefined): AnywhereState | null {
  const [state, setState] = useState<AnywhereState | null>(null)
  useEffect(() => {
    if (!hoot) return
    let pushed = false
    const off = hoot.anywhere.onUpdate((s) => {
      pushed = true
      setState(s)
    })
    // A push that arrives before the reply is newer than it.
    hoot.anywhere.current().then(
      (s) => {
        if (!pushed && s) setState(s)
      },
      () => undefined
    )
    return off
  }, [hoot])
  return state
}

/**
 * Lens anywhere: a small glass bubble under text selected in another app,
 * with Lens's clearer version and what to do next. The same light-blue glass
 * as the live capture chat.
 */
function Bubble({ hoot }: { hoot: HootApi | undefined }): React.JSX.Element {
  const { state: slices } = useHootState(hoot, SLICES)
  const system = slices?.system
  const s = useAnywhere(hoot)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!system) return
    applyTheme(system.darkMode ? 'dark' : 'light')
    applyAccent(system.accentColor)
  }, [system])

  // The window follows the bubble's height (main caps it).
  useEffect(() => {
    const el = root.current
    if (!el || !hoot) return
    const observer = new ResizeObserver(() =>
      hoot.anywhere.resize(Math.ceil(el.getBoundingClientRect().height))
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hoot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void hoot?.anywhere.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hoot])

  return (
    <div ref={root} className="anywhere">
      {s && <Card key={s.id} s={s} hoot={hoot} />}
    </div>
  )
}

function Card({ s, hoot }: { s: AnywhereState; hoot: HootApi | undefined }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (hover || s.status === 'empty') return
    const t = setTimeout(() => void hoot?.anywhere.close(), IDLE_MS)
    return () => clearTimeout(t)
  }, [s, hover, hoot])

  const act = (action: AnywhereAction): Promise<void> =>
    hoot ? hoot.anywhere.act(action).catch(() => undefined) : Promise.resolve()

  const copy = (): void => {
    void act('copy').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const result = s.status === 'done' ? s.result : null
  const errorAction = s.status === 'error' && s.error?.action ? s.error.action : null

  return (
    <section
      className="anywhere__card"
      data-side={s.side}
      data-status={s.status}
      aria-label="Hoot Lens"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <header className="anywhere__head hoot-chrome">
        <span className="anywhere__dot" aria-hidden="true" />
        <span className="anywhere__title">Hoot Lens</span>
        {s.app && (
          <span className="anywhere__app" title={s.app}>
            {s.app}
          </span>
        )}
        <button
          type="button"
          className="anywhere__icon anywhere__close"
          aria-label="Close"
          title="Close (Esc)"
          onClick={() => void hoot?.anywhere.close()}
        >
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="anywhere__body" aria-live="polite" aria-busy={s.status === 'loading'}>
        {s.status === 'loading' && (
          <div className="anywhere__shimmer" role="status" aria-label="Hoot is reading">
            <span />
            <span />
          </div>
        )}
        {result && (
          <>
            <div className="anywhere__label-row hoot-chrome">
              <p className="anywhere__label">
                <Sparkles aria-hidden="true" />
                {TRANSFORM_RULES[result.transform].label}
              </p>
              <button
                type="button"
                className="anywhere__icon"
                aria-label={copied ? 'Copied' : 'Copy'}
                title={copied ? 'Copied' : 'Copy'}
                onClick={copy}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="anywhere__icon"
                aria-label="Pin as a note"
                title="Pin as a note"
                onClick={() => void act('pin')}
              >
                <Pin aria-hidden="true" />
              </button>
            </div>
            <p className="anywhere__rewrite">{result.text}</p>
          </>
        )}
        {s.message && <p className="anywhere__message">{s.message}</p>}
        {s.original && (
          <p className="anywhere__original" title={s.original}>
            {s.original}
          </p>
        )}
      </div>

      {result && (
        <div className="anywhere__actions hoot-chrome">
          <button type="button" className="anywhere__pill" onClick={() => void act('explain')}>
            <Sparkles aria-hidden="true" />
            Explain more
          </button>
          <button type="button" className="anywhere__pill" onClick={() => void act('chat')}>
            <MessagesSquare aria-hidden="true" />
            Open in chat
          </button>
          <button type="button" className="anywhere__link" onClick={() => void act('knewIt')}>
            I knew this
          </button>
        </div>
      )}
      {s.status === 'skipped' && (
        <div className="anywhere__actions hoot-chrome">
          <button
            type="button"
            className="anywhere__pill anywhere__pill--primary"
            onClick={() => void act('explain')}
          >
            <Sparkles aria-hidden="true" />
            Explain anyway
          </button>
        </div>
      )}
      {errorAction && (
        <div className="anywhere__actions hoot-chrome">
          <button
            type="button"
            className="anywhere__pill anywhere__pill--primary"
            onClick={() => void act(errorAction)}
          >
            {ERROR_ACTIONS[errorAction].icon}
            {ERROR_ACTIONS[errorAction].label}
          </button>
        </div>
      )}
    </section>
  )
}
