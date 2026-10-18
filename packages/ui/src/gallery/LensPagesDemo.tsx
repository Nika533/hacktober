import { useState } from 'react'
import { GlossaryPane } from '../lens/GlossaryPane'
import { ProfilePane } from '../lens/ProfilePane'
import { useLensPages } from '../lens/useLensPages'
import { StudioLayout } from '../studio/StudioLayout'
import { StudioSidebar } from '../studio/StudioSidebar'
import { createFakeLensPages } from './fakeLensPages'

const noop = (): void => undefined

/** "What Hoot knows about you" or "My glossary" in the Studio frame, on a fake main. */
export function LensPagesDemo({ page }: { page: 'profile' | 'glossary' }): React.JSX.Element {
  const [api] = useState(createFakeLensPages)
  const data = useLensPages(api, true)
  return (
    <div className={`gallery__studio gallery__studio--tall gallery__${page}`}>
      <StudioLayout
        sidebar={
          <StudioSidebar
            sessions={[]}
            activeId={null}
            summonShortcut="Ctrl+Shift+Space"
            onOpen={noop}
            onRename={noop}
            onDelete={noop}
            onUndoDelete={noop}
            onNewChat={noop}
            onOpenSettings={noop}
          />
        }
      >
        {page === 'profile' ? (
          <ProfilePane
            profile={data.profile}
            changes={data.changes}
            failed={data.failed}
            onRetry={data.reload}
            onPatch={data.patch}
            onExport={api.exportProfile}
            onReset={data.reset}
            onBack={noop}
          />
        ) : (
          <GlossaryPane
            entries={data.glossary}
            failed={data.failed}
            onRetry={data.reload}
            onPin={() => Promise.resolve()}
            onMarkKnown={(term) => data.patch({ terms: { [term]: 'known' } })}
            onBack={noop}
          />
        )}
      </StudioLayout>
    </div>
  )
}
