import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppState } from '../../../shared/types'
import { Owl } from '../shared/Owl'

function keycaps(acc: string): string[] {
  return acc.replace('CommandOrControl', 'Ctrl').split('+')
}

export function Onboarding({ state }: { state: AppState }): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [key, setKey] = useState('')
  const [validating, setValidating] = useState(false)
  const [keyErr, setKeyErr] = useState(false)

  // main gates the summon hotkey on the last step
  useEffect(() => {
    window.hoot.onboarding.setStep(step)
  }, [step])

  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    setValidating(true)
    const ok = await window.hoot.settings.validateApiKey(key.trim())
    setValidating(false)
    if (ok) {
      window.hoot.settings.setApiKey(key.trim())
      setStep(2)
    } else {
      setKeyErr(true)
    }
  }

  return (
    <div className="onboarding">
      {step === 0 ? (
        <div className="ob-step">
          <Owl mood="idle" size={112} />
          <div className="ob-title">Hi, I’m Hoot</div>
          <div className="ob-sub t-body">
            I live in your tray. Circle anything on screen and ask me about it.
          </div>
          <button type="button" className="chip t-body accent" onClick={() => setStep(1)}>
            Continue
          </button>
        </div>
      ) : step === 1 ? (
        <div className="ob-step">
          <div className="ob-title">Add your Anthropic API key</div>
          <div className="ob-sub t-body">
            Hoot uses Claude to answer. Your key stays on this PC.
          </div>
          <input
            className="text-field t-body ob-key"
            type="password"
            placeholder="sk-ant-…"
            autoFocus
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setKeyErr(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveKey()
            }}
          />
          {keyErr ? (
            <div className="t-small key-err">
              <X size={12} /> That key was rejected — check it and try again, or skip for now.
            </div>
          ) : null}
          <div className="ob-row">
            <button
              type="button"
              className="chip t-body accent"
              disabled={validating || !key.trim()}
              onClick={() => void saveKey()}
            >
              {validating ? (
                'Checking…'
              ) : (
                <>
                  <Check size={14} /> Save & continue
                </>
              )}
            </button>
            <button type="button" className="link-btn t-body" onClick={() => setStep(2)}>
              Skip for now
            </button>
          </div>
        </div>
      ) : (
        <div className="ob-step">
          <div className="ob-title">Summon me anytime</div>
          <div className="ob-keys">
            {keycaps(state.settings.summonHotkey).map((k) => (
              <kbd key={k} className="keycap">
                {k}
              </kbd>
            ))}
            <span className="t-body" style={{ color: 'var(--text-2)' }}>
              circle something
            </span>
            {keycaps(state.settings.captureHotkey).map((k) => (
              <kbd key={k} className="keycap">
                {k}
              </kbd>
            ))}
          </div>
          <div className="ob-sub t-body">Try it now: press Ctrl+Shift+Space</div>
          <button
            type="button"
            className="chip t-body accent"
            onClick={() => window.hoot.onboarding.finish()}
          >
            Finish
          </button>
        </div>
      )}
      <div className="ob-dots">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`ob-dot ${i === step ? 'active' : ''}`} />
        ))}
      </div>
    </div>
  )
}
