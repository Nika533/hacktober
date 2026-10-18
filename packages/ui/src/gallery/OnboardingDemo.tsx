import { DEFAULT_SETTINGS, type ApiKeyResult, type Settings } from '@hoot/core'
import { useEffect, useState } from 'react'
import { OnboardingPane } from '../onboarding/OnboardingPane'
import { ONBOARDING_STEPS } from '../onboarding/steps'

const LAST = ONBOARDING_STEPS.length - 1

/**
 * First run with a fake main: keys starting with "bad" are rejected, the
 * extension "connects" a moment after you reach the last step, and Finish
 * starts over.
 */
export function OnboardingDemo(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hasKey, setHasKey] = useState(false)
  const [clients, setClients] = useState(0)

  useEffect(() => {
    if (step !== LAST) return
    const t = setTimeout(() => setClients(1), 1500)
    return () => {
      clearTimeout(t)
      setClients(0)
    }
  }, [step])

  const saveKey = async (key: string): Promise<ApiKeyResult> => {
    await new Promise((r) => setTimeout(r, 600))
    if (key.startsWith('bad')) return { ok: false, reason: 'rejected' }
    setHasKey(true)
    return { ok: true }
  }

  return (
    <div className="gallery__studio gallery__onboarding">
      <OnboardingPane
        step={step}
        summonHotkey={settings.summonHotkey}
        captureHotkey={settings.captureHotkey}
        hasApiKey={hasKey}
        keyStorage="os-encrypted"
        lens={{ bridge: clients > 0 ? 'connected' : 'listening', clients }}
        onStep={(n) => setStep(Math.min(Math.max(0, n), LAST))}
        onFinish={() => setStep(0)}
        onUpdate={(patch) => setSettings((s) => ({ ...s, ...patch, lens: s.lens }))}
        onSaveKey={saveKey}
        onOpenLink={() => undefined}
      />
    </div>
  )
}
