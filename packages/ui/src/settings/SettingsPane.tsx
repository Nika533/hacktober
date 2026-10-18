import {
  CHAT_MODELS,
  DEFAULT_SETTINGS,
  type ApiKeyResult,
  type ChatModelId,
  type Settings,
  type SettingsPatch
} from '@hoot/core'
import { ArrowLeft } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { useConfirm } from '../components/confirmContext'
import { IconButton } from '../components/IconButton'
import { Segmented } from '../components/Segmented'
import { Switch } from '../components/Switch'
import { TextField } from '../components/TextField'
import { useToast } from '../components/toastContext'
import { formatAccelerator } from './accelerator'
import { ApiKeyField } from './ApiKeyField'
import { HotkeyRecorder } from './HotkeyRecorder'

export interface SettingsPaneProps {
  settings: Settings
  hasApiKey: boolean
  keyStorage: 'os-encrypted' | 'memory'
  /** Registration problems per shortcut, already turned into sentences by the host. */
  hotkeyErrors?: { summonHotkey?: string; captureHotkey?: string }
  /** App version for the About line. */
  version?: string
  onUpdate: (patch: SettingsPatch) => void
  onSaveKey: (key: string) => Promise<ApiKeyResult>
  onClearKey: () => Promise<void>
  onClearChats: () => Promise<void>
  onResetAnchor: () => Promise<void>
  onOpenLink: (url: string) => void
  /** Pause Hoot's global shortcuts while one is being re-recorded. */
  onRecordingChange?: (recording: boolean) => void
  onBack: () => void
}

const COLLAPSE: { value: string; label: string }[] = [
  { value: '5000', label: '5 s' },
  { value: '10000', label: '10 s' },
  { value: '30000', label: '30 s' },
  { value: '0', label: 'Never' }
]

/** Studio → Settings: key, model, shortcuts, behaviour and data. Every change saves at once. */
export function SettingsPane({
  settings: s,
  hasApiKey,
  keyStorage,
  hotkeyErrors,
  version,
  onUpdate,
  onSaveKey,
  onClearKey,
  onClearChats,
  onResetAnchor,
  onOpenLink,
  onRecordingChange,
  onBack
}: SettingsPaneProps): React.JSX.Element {
  const titleId = useId()
  const confirm = useConfirm()
  const toast = useToast()
  const [translateTo, setTranslateTo] = useState(s.translateTo)
  const paid = CHAT_MODELS.find((m) => m.id === s.model)?.paidOnly ?? false

  const taken = (other: string, what: string) => (acc: string) =>
    acc === other ? `${formatAccelerator(acc)} already ${what}.` : null

  const commitTranslate = (): void => {
    const v = translateTo.trim()
    if (v && v !== s.translateTo) onUpdate({ translateTo: v })
    else setTranslateTo(s.translateTo)
  }

  return (
    <section className="hoot-settings" aria-labelledby={titleId}>
      <header className="hoot-chat-pane__header hoot-studio-drag">
        <IconButton label="Back to chat" className="hoot-studio-no-drag" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <h1 id={titleId} className="hoot-chat-pane__title">
          Settings
        </h1>
      </header>
      <div className="hoot-settings__scroll">
        <Group title="Gemini API key">
          <ApiKeyField
            hasKey={hasApiKey}
            keyStorage={keyStorage}
            onSave={onSaveKey}
            onOpenLink={onOpenLink}
          />
          {hasApiKey && (
            <div>
              <Button
                variant="ghost"
                onClick={() =>
                  void confirm({
                    title: 'Remove your API key?',
                    body: 'Hoot can’t answer until you add a key again. Your chats stay.',
                    confirmLabel: 'Remove key',
                    tone: 'danger'
                  }).then((ok) => {
                    if (ok) void onClearKey().then(() => toast.show({ message: 'API key removed' }))
                  })
                }
              >
                Remove key
              </Button>
            </div>
          )}
        </Group>

        <Group title="Model">
          <Segmented<ChatModelId>
            label="Model"
            hideLabel
            value={s.model}
            onChange={(model) => onUpdate({ model })}
            options={CHAT_MODELS.map((m) => ({
              value: m.id,
              label: m.label,
              hint: m.paidOnly ? 'paid tier' : m.sub
            }))}
          />
          <p className="hoot-settings__note">
            {paid
              ? 'Argon needs a paid-tier Gemini key. With a free key, answers fail with “Google rejected the API key”.'
              : 'Flash is a good default. Flash-Lite answers fastest; Argon is the smartest but needs a paid-tier key.'}
          </p>
        </Group>

        <Group title="Shortcuts">
          <HotkeyRecorder
            label="Summon Hoot"
            description="Opens the owl from anywhere."
            value={s.summonHotkey}
            defaultValue={DEFAULT_SETTINGS.summonHotkey}
            onChange={(summonHotkey) => onUpdate({ summonHotkey })}
            validate={taken(s.captureHotkey, 'starts Circle anything')}
            error={hotkeyErrors?.summonHotkey}
            onRecordingChange={onRecordingChange}
          />
          <HotkeyRecorder
            label="Circle anything"
            description="Starts a screen capture to ask about."
            value={s.captureHotkey}
            defaultValue={DEFAULT_SETTINGS.captureHotkey}
            onChange={(captureHotkey) => onUpdate({ captureHotkey })}
            validate={taken(s.summonHotkey, 'summons Hoot')}
            error={hotkeyErrors?.captureHotkey}
            onRecordingChange={onRecordingChange}
          />
        </Group>

        <Group title="Behaviour">
          <Switch
            label="Launch at login"
            description="Hoot starts hidden in the tray when you sign in."
            checked={s.launchAtLogin}
            onChange={(launchAtLogin) => onUpdate({ launchAtLogin })}
          />
          <Switch
            label="Save chat history"
            description="Chats stay on this PC. Turn off to stop saving new chats."
            checked={s.saveHistory}
            onChange={(saveHistory) => onUpdate({ saveHistory })}
          />
          <Switch
            label="Restore pinned notes"
            description="Bring sticky notes back when Hoot starts."
            checked={s.restorePins}
            onChange={(restorePins) => onUpdate({ restorePins })}
          />
          <Switch
            label="Suggest copied text"
            description="Shows a chip for what you just copied. It never sends on its own."
            checked={s.clipboardHint}
            onChange={(clipboardHint) => onUpdate({ clipboardHint })}
          />
          <Segmented
            label="Shrink the pill to a dot after"
            size="sm"
            value={String(s.collapseToDotAfterMs)}
            options={COLLAPSE}
            onChange={(v) => onUpdate({ collapseToDotAfterMs: Number(v) })}
          />
          <TextField
            label="Translate into"
            description="Used by the Translate quick action."
            value={translateTo}
            onChange={(e) => setTranslateTo(e.currentTarget.value)}
            onBlur={commitTranslate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTranslate()
            }}
          />
        </Group>

        <Group title="Data">
          <div className="hoot-settings__row">
            <div>
              <p className="hoot-settings__label">Clear all chats</p>
              <p className="hoot-settings__note">Deletes every chat and capture on this PC.</p>
            </div>
            <Button
              variant="danger"
              onClick={() =>
                void confirm({
                  title: 'Clear all chats?',
                  body: 'Every chat and capture on this PC is deleted. Pinned notes and settings stay. This can’t be undone.',
                  confirmLabel: 'Clear all chats',
                  tone: 'danger'
                }).then((ok) => {
                  if (ok)
                    void onClearChats().then(() => toast.show({ message: 'All chats cleared' }))
                })
              }
            >
              Clear all chats…
            </Button>
          </div>
          <div className="hoot-settings__row">
            <div>
              <p className="hoot-settings__label">Owl position</p>
              <p className="hoot-settings__note">Move the owl back to its starting corner.</p>
            </div>
            <Button
              onClick={() =>
                void onResetAnchor().then(() => toast.show({ message: 'Owl moved back' }))
              }
            >
              Reset position
            </Button>
          </div>
        </Group>

        {version && <p className="hoot-settings__about">Hoot {version}</p>}
      </div>
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  const id = useId()
  return (
    <section className="hoot-settings__group" aria-labelledby={id}>
      <h2 id={id} className="hoot-settings__heading">
        {title}
      </h2>
      {children}
    </section>
  )
}
