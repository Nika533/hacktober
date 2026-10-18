import { DEFAULT_SETTINGS, type LensSettings } from '@hoot/core'
import { applySettingsPatch } from '@hoot/core/schemas'
import { useState } from 'react'
import { ReadingPane } from '../lens/ReadingPane'
import { StudioLayout } from '../studio/StudioLayout'
import { StudioSidebar } from '../studio/StudioSidebar'

/** Studio → Reading on local state: consent first, then every Lens setting. */
export function ReadingDemo(): React.JSX.Element {
  const [lens, setLens] = useState<LensSettings>({
    ...DEFAULT_SETTINGS.lens,
    sites: { 'example.com': 'paused', 'docs.python.org': 'always' }
  })
  return (
    <div className="gallery__studio gallery__studio--tall gallery__reading">
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
            onOpenReading={() => undefined}
          />
        }
      >
        <ReadingPane
          lens={lens}
          status={{ bridge: 'connected', clients: 1 }}
          onUpdate={(patch) =>
            setLens(
              (l) => applySettingsPatch({ ...DEFAULT_SETTINGS, lens: l }, { lens: patch }).lens
            )
          }
          onOpenView={() => undefined}
          onOpenLink={() => undefined}
          onBack={() => undefined}
        />
      </StudioLayout>
    </div>
  )
}
