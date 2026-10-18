import { DEFAULT_SETTINGS, type HotkeyError, type Settings, type SettingsPatch } from '@hoot/core'
import { formatAccelerator } from './accelerator'
import { HotkeyRecorder } from './HotkeyRecorder'

export interface ShortcutFieldsProps {
  summonHotkey: Settings['summonHotkey']
  captureHotkey: Settings['captureHotkey']
  /** Lens anywhere; its row shows only when given (Settings, not onboarding). */
  lensHotkey?: Settings['lensHotkey']
  /** Registration problems per shortcut, already turned into sentences by the host. */
  errors?: Partial<Record<HotkeyError['which'], string>>
  onUpdate: (patch: SettingsPatch) => void
  /** Pause Hoot's global shortcuts while one is being re-recorded. */
  onRecordingChange?: (recording: boolean) => void
}

const SUMMONS = 'summons Hoot'
const CIRCLES = 'starts Circle anything'
const LENS = 'explains a selection with Lens'

/** Hoot's global shortcuts. Shared by Settings and onboarding; refuses giving two the same keys. */
export function ShortcutFields({
  summonHotkey,
  captureHotkey,
  lensHotkey,
  errors,
  onUpdate,
  onRecordingChange
}: ShortcutFieldsProps): React.JSX.Element {
  const taken =
    (...others: [string | undefined, string][]) =>
    (acc: string): string | null => {
      const hit = others.find(([other]) => other === acc)
      return hit ? `${formatAccelerator(acc)} already ${hit[1]}.` : null
    }

  return (
    <>
      <HotkeyRecorder
        label="Summon Hoot"
        description="Opens the owl from anywhere."
        value={summonHotkey}
        defaultValue={DEFAULT_SETTINGS.summonHotkey}
        onChange={(v) => onUpdate({ summonHotkey: v })}
        validate={taken([captureHotkey, CIRCLES], [lensHotkey, LENS])}
        error={errors?.summonHotkey}
        onRecordingChange={onRecordingChange}
      />
      <HotkeyRecorder
        label="Circle anything"
        description="Starts a screen capture to ask about."
        value={captureHotkey}
        defaultValue={DEFAULT_SETTINGS.captureHotkey}
        onChange={(v) => onUpdate({ captureHotkey: v })}
        validate={taken([summonHotkey, SUMMONS], [lensHotkey, LENS])}
        error={errors?.captureHotkey}
        onRecordingChange={onRecordingChange}
      />
      {lensHotkey !== undefined && (
        <HotkeyRecorder
          label="Lens on a selection"
          description="Select text in any app, then press this to make it clearer."
          value={lensHotkey}
          defaultValue={DEFAULT_SETTINGS.lensHotkey}
          onChange={(v) => onUpdate({ lensHotkey: v })}
          validate={taken([summonHotkey, SUMMONS], [captureHotkey, CIRCLES])}
          error={errors?.lensHotkey}
          onRecordingChange={onRecordingChange}
        />
      )}
    </>
  )
}
