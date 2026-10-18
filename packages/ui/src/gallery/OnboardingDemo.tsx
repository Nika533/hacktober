import { DEFAULT_SETTINGS, type ApiKeyResult, type Settings } from '@hoot/core'
import { useState } from 'react'
import { OnboardingPane } from '../onboarding/OnboardingPane'
import { ONBOARDING_STEPS } from '../onboarding/steps'

/** First run with a fake main: keys starting with "bad" are rejected; Finish starts over. */
export function OnboardingDemo(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hasKey, setHasKey] = useState(false)

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
        onStep={(n) => setStep(Math.min(Math.max(0, n), ONBOARDING_STEPS.length - 1))}
        onFinish={() => setStep(0)}
        onUpdate={(patch) => setSettings((s) => ({ ...s, ...patch, lens: s.lens }))}
        onSaveKey={saveKey}
        onOpenLink={() => undefined}
      />
    </div>
  )
}
