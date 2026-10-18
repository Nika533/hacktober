import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@hoot/core'
import { formatAccelerator } from './accelerator'
import { HotkeyRecorder } from './HotkeyRecorder'

export interface ShortcutFieldsProps {
  summonHotkey: Settings['summonHotkey']
  captureHotkey: Settings['captureHotkey']
  /** Registration problems per shortcut, already turned into sentences by the host. */
  errors?: { summonHotkey?: string; captureHotkey?: string }
  onUpdate: (patch: SettingsPatch) => void
  /** Pause Hoot's global shortcuts while one is being re-recorded. */
  onRecordingChange?: (recording: boolean) => void
}

/** Hoot's two global shortcuts. Shared by Settings and onboarding; refuses giving both the same keys. */
export function ShortcutFields({
  summonHotkey,
  captureHotkey,
  errors,
  onUpdate,
  onRecordingChange
}: ShortcutFieldsProps): React.JSX.Element {
  const taken = (other: string, what: string) => (acc: string) =>
    acc === other ? `${formatAccelerator(acc)} already ${what}.` : null

  return (
    <>
      <HotkeyRecorder
        label="Summon Hoot"
        description="Opens the owl from anywhere."
        value={summonHotkey}
        defaultValue={DEFAULT_SETTINGS.summonHotkey}
        onChange={(v) => onUpdate({ summonHotkey: v })}
        validate={taken(captureHotkey, 'starts Circle anything')}
        error={errors?.summonHotkey}
        onRecordingChange={onRecordingChange}
      />
      <HotkeyRecorder
        label="Circle anything"
        description="Starts a screen capture to ask about."
        value={captureHotkey}
        defaultValue={DEFAULT_SETTINGS.captureHotkey}
        onChange={(v) => onUpdate({ captureHotkey: v })}
        validate={taken(summonHotkey, 'summons Hoot')}
        error={errors?.captureHotkey}
        onRecordingChange={onRecordingChange}
      />
    </>
  )
}
