import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, ModelId, Settings } from '../../../shared/types'
import { toAccelerator } from '../../../shared/accelerator'

const MODELS: { id: ModelId; label: string; sub: string }[] = [
  { id: 'gemini-3.5-flash-lite', label: 'Flash-Lite', sub: 'fastest' },
  { id: 'gemini-3.8-flash', label: 'Flash', sub: 'balanced' },
  { id: 'gemini-4-argon', label: 'Argon', sub: 'smartest · paid tier' }
]

const COLLAPSE_OPTS: { label: string; ms: number }[] = [
  { label: '5 s', ms: 5000 },
  { label: '10 s', ms: 10_000 },
  { label: '30 s', ms: 30_000 },
  { label: 'Never', ms: 0 }
]

function prettyAcc(acc: string): string {
  return acc.replace('CommandOrControl', 'Ctrl').replace('Alt', 'Alt')
}

function HotkeyField({
  label,
  value,
  which
}: {
  label: string
  value: string
  which: 'summonHotkey' | 'captureHotkey'
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <div className="set-row">
      <span className="t-body">{label}</span>
      <button
        ref={ref}
        type="button"
        className={`keycap-field t-small ${recording ? 'recording' : ''}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Escape') {
            setRecording(false)
            return
          }
          const acc = toAccelerator(e)
          if (!acc) return
          window.hoot.settings.update({ [which]: acc })
          setRecording(false)
          ref.current?.blur()
        }}
      >
        {recording ? 'Press keys…' : <kbd className="keycap">{prettyAcc(value)}</kbd>}
      </button>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  note
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  note?: string
}): React.JSX.Element {
  return (
    <label className={`set-row toggle-row ${disabled ? 'disabled' : ''}`}>
      <span className="t-body">
        {label}
        {note ? (
          <span className="t-small" style={{ color: 'var(--text-3)' }}>
            {' '}
            · {note}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function SettingsPane({ state }: { state: AppState }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [keyStatus, setKeyStatus] = useState<'idle' | 'ok' | 'bad'>('idle')
  const [validating, setValidating] = useState(false)
  const [packaged, setPackaged] = useState(false)
  const s = state.settings

  useEffect(() => {
    void window.hoot.app.info().then((i) => setPackaged(i.packaged))
  }, [])

  const update = (patch: Partial<Settings>): void => {
    window.hoot.settings.update(patch)
  }

  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    setValidating(true)
    const ok = await window.hoot.settings.validateApiKey(key.trim())
    setValidating(false)
    if (ok) {
      window.hoot.settings.setApiKey(key.trim())
      setKey('')
      setKeyStatus('ok')
    } else {
      setKeyStatus('bad')
    }
  }

  const hotkeyErrorFor = (label: string): string[] =>
    state.hotkeyErrors.filter((h) => h.includes(label))

  return (
    <main className="pane">
      <header className="pane-header drag">
        <span className="pane-title t-title">Settings</span>
      </header>
      <div className="settings-scroll">
        <section className="set-section">
          <div className="set-label t-small">API key</div>
          {state.hasApiKey ? (
            <div className="set-row">
              <span className="t-body conn-ok">
                <Check size={14} /> Connected
              </span>
              <button
                type="button"
                className="link-btn t-small"
                onClick={() => window.hoot.settings.clearApiKey()}
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <div className="set-row">
                <input
                  className="text-field t-body"
                  type="password"
                  placeholder="AIza…"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value)
                    setKeyStatus('idle')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKey()
                  }}
                />
                <button
                  type="button"
                  className="chip t-small"
                  disabled={validating || !key.trim()}
                  onClick={() => void saveKey()}
                >
                  {validating ? 'Checking…' : 'Save'}
                </button>
              </div>
              {keyStatus === 'bad' ? (
                <div className="t-small key-err">
                  <X size={12} /> Key rejected
                </div>
              ) : null}
            </>
          )}
          <a
            href="#"
            className="link-btn t-small"
            onClick={(e) => {
              e.preventDefault()
              window.hoot.settings.openExternal('https://aistudio.google.com/apikey')
            }}
          >
            Get a key at aistudio.google.com
          </a>
        </section>

        <section className="set-section">
          <div className="set-label t-small">Model</div>
          <div className="seg">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`seg-btn t-small ${s.model === m.id ? 'active' : ''}`}
                onClick={() => update({ model: m.id })}
              >
                {m.label}
                <span className="seg-sub">{m.sub}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="set-section">
          <div className="set-label t-small">Hotkeys</div>
          <HotkeyField label="Summon Hoot" value={s.summonHotkey} which="summonHotkey" />
          {hotkeyErrorFor('Summon Hoot').map((err) => (
            <div key={err} className="t-small key-err">
              {err}
            </div>
          ))}
          <HotkeyField label="Circle something" value={s.captureHotkey} which="captureHotkey" />
          {hotkeyErrorFor('Circle something').map((err) => (
            <div key={err} className="t-small key-err">
              {err}
            </div>
          ))}
        </section>

        <section className="set-section">
          <div className="set-label t-small">Translate to</div>
          <input
            className="text-field t-body"
            placeholder="e.g. Spanish"
            value={s.translateTo}
            onChange={(e) => update({ translateTo: e.target.value })}
          />
        </section>

        <section className="set-section">
          <div className="set-label t-small">Behaviour</div>
          <Toggle
            label="Launch at login"
            checked={s.launchAtLogin}
            disabled={!packaged}
            note={packaged ? undefined : 'Available in the installed app'}
            onChange={(v) => update({ launchAtLogin: v })}
          />
          <Toggle
            label="Save chat history"
            checked={s.saveHistory}
            onChange={(v) => update({ saveHistory: v })}
          />
          <Toggle
            label="Show clipboard suggestions"
            checked={s.clipboardHint}
            onChange={(v) => update({ clipboardHint: v })}
          />
          <Toggle
            label="Restore pinned notes"
            checked={s.restorePins}
            onChange={(v) => update({ restorePins: v })}
          />
          <div className="set-row">
            <span className="t-body">Collapse to dot after</span>
            <div className="seg">
              {COLLAPSE_OPTS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className={`seg-btn t-small ${s.collapseToDotAfterMs === o.ms ? 'active' : ''}`}
                  onClick={() => update({ collapseToDotAfterMs: o.ms })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="set-section">
          <div className="set-label t-small">Maintenance</div>
          <div className="set-row">
            <button
              type="button"
              className="chip t-small"
              onClick={() => window.hoot.settings.resetAnchor()}
            >
              Reset Hoot position
            </button>
            <button
              type="button"
              className="chip t-small danger"
              onClick={() => {
                if (window.confirm('Delete all chat history? This can’t be undone.')) {
                  window.hoot.sessions.clearAll()
                }
              }}
            >
              Clear chat history
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
