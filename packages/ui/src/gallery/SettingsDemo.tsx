import { DEFAULT_SETTINGS, type ApiKeyResult, type Settings } from '@hoot/core'
import { useState } from 'react'
import { SettingsPane } from '../settings/SettingsPane'
import { StudioLayout } from '../studio/StudioLayout'
import { StudioSidebar } from '../studio/StudioSidebar'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Studio → Settings with a fake main: keys starting with "bad" are rejected. */
export function SettingsDemo(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hasKey, setHasKey] = useState(false)

  const saveKey = async (key: string): Promise<ApiKeyResult> => {
    await wait(600)
    if (key.startsWith('bad')) return { ok: false, reason: 'rejected' }
    setHasKey(true)
    return { ok: true }
  }

  return (
    <div className="gallery__studio gallery__studio--tall gallery__settings">
      <StudioLayout
        sidebar={
          <StudioSidebar
            sessions={[]}
            activeId={null}
            summonShortcut="Ctrl+Shift+Space"
            onOpen={() => undefined}
            onRename={() => undefined}
            onDelete={() => undefined}
            onUndoDelete={() => undefined}
            onNewChat={() => undefined}
            onOpenSettings={() => undefined}
          />
        }
      >
        <SettingsPane
          settings={settings}
          hasApiKey={hasKey}
          keyStorage="os-encrypted"
          version="1.0.0"
          onUpdate={(patch) => setSettings((s) => ({ ...s, ...patch, lens: s.lens }))}
          onSaveKey={saveKey}
          onClearKey={async () => setHasKey(false)}
          onClearChats={() => wait(300)}
          onResetAnchor={() => wait(150)}
          onOpenLink={() => undefined}
          onBack={() => undefined}
        />
      </StudioLayout>
    </div>
  )
}
