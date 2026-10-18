import type { SessionMeta } from '@hoot/core'
import { useState } from 'react'
import { ChatPane } from '../studio/ChatPane'
import { StudioLayout } from '../studio/StudioLayout'
import { StudioSidebar } from '../studio/StudioSidebar'
import { CONVERSATION } from './fixtures'

const DAY = 86_400_000
const now = Date.now()
const meta = (id: string, title: string, ago: number): SessionMeta => ({
  id,
  title,
  createdAt: now - ago,
  updatedAt: now - ago,
  messageCount: 4
})

const SESSIONS: SessionMeta[] = [
  meta('s1', 'Quarterly revenue chart', 60_000),
  meta('s2', 'Excel VLOOKUP returns #N/A', 3_600_000),
  meta('s3', 'Translate the restaurant menu', DAY + 1),
  meta('s4', 'Fix this Python traceback', 3 * DAY),
  meta('s5', 'Summarize the lease PDF', 20 * DAY)
]

/** The Studio frame with fake sessions: sidebar on the left, chat on the right. */
export function StudioDemo(): React.JSX.Element {
  const [sessions, setSessions] = useState(SESSIONS)
  const [active, setActive] = useState('s1')
  const [removed, setRemoved] = useState<SessionMeta[]>([])
  const current = sessions.find((s) => s.id === active)
  return (
    <div className="gallery__studio">
      <StudioLayout
        sidebar={
          <StudioSidebar
            sessions={sessions}
            activeId={active}
            summonShortcut="Ctrl+Shift+Space"
            onOpen={setActive}
            onRename={(id, title) =>
              setSessions((list) => list.map((s) => (s.id === id ? { ...s, title } : s)))
            }
            onDelete={(id) => {
              const gone = sessions.find((s) => s.id === id)
              if (gone) setRemoved((r) => [...r, gone])
              setSessions((list) => list.filter((s) => s.id !== id))
            }}
            onUndoDelete={(id) => {
              const back = removed.find((s) => s.id === id)
              if (back)
                setSessions((list) => [...list, back].sort((a, b) => b.updatedAt - a.updatedAt))
            }}
            onNewChat={() => setActive('')}
            onOpenSettings={() => undefined}
          />
        }
      >
        <ChatPane
          title={current?.title ?? null}
          messages={current?.id === 's1' ? CONVERSATION : []}
          streaming={false}
          onSend={() => undefined}
          onStop={() => undefined}
          onNewChat={() => setActive('')}
          onLock={() => undefined}
          onCopy={() => undefined}
        />
      </StudioLayout>
    </div>
  )
}
