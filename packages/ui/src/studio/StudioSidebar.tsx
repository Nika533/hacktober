import type { SessionMeta } from '@hoot/core'
import { BookOpenText, Plus, Search, Settings2 } from 'lucide-react'
import { useMemo, useState, type Ref } from 'react'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { Owl } from '../components/Owl'
import { TextField } from '../components/TextField'
import { useToast } from '../components/toastContext'
import { SessionList } from './SessionList'

export interface StudioSidebarProps {
  sessions: readonly SessionMeta[]
  activeId: string | null
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  /** Soft delete; the sidebar offers Undo for 5 s through onUndoDelete. */
  onDelete: (id: string) => void
  onUndoDelete: (id: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
  /** Studio → Reading (Hoot Lens); the button shows only when given. */
  onOpenReading?: () => void
  /** Shown in the footer as a reminder, e.g. 'Ctrl+Shift+Space'. */
  summonShortcut?: string
  searchRef?: Ref<HTMLInputElement>
}

/** Studio's left column: brand, New chat, search, the chat list, Settings and Reading. */
export function StudioSidebar({
  sessions,
  activeId,
  onOpen,
  onRename,
  onDelete,
  onUndoDelete,
  onNewChat,
  onOpenSettings,
  onOpenReading,
  summonShortcut,
  searchRef
}: StudioSidebarProps): React.JSX.Element {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions),
    [sessions, q]
  )

  return (
    <div className="hoot-studio-sidebar">
      <div className="hoot-studio-sidebar__brand hoot-studio-drag hoot-chrome">
        <Owl mood="idle" size={24} />
        <span>Hoot</span>
      </div>
      <div className="hoot-studio-sidebar__top">
        <Button icon={<Plus />} onClick={onNewChat} aria-keyshortcuts="Control+N">
          New chat
        </Button>
        <TextField
          ref={searchRef}
          label="Search chats"
          hideLabel
          type="search"
          placeholder="Search chats"
          leading={<Search />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault()
              setQuery('')
            }
          }}
          aria-keyshortcuts="Control+F"
        />
      </div>
      <SessionList
        className="hoot-studio-sidebar__list"
        sessions={shown}
        activeId={activeId}
        query={q ? query.trim() : undefined}
        onOpen={onOpen}
        onRename={onRename}
        onDelete={(m) => {
          onDelete(m.id)
          toast.show({
            message: `Deleted “${m.title || 'Untitled chat'}”`,
            action: { label: 'Undo', onAction: () => onUndoDelete(m.id) }
          })
        }}
      />
      <div className="hoot-studio-sidebar__foot hoot-chrome">
        <IconButton label="Settings" shortcut="Ctrl+," onClick={onOpenSettings}>
          <Settings2 />
        </IconButton>
        {onOpenReading && (
          <IconButton label="Reading (Hoot Lens)" onClick={onOpenReading}>
            <BookOpenText />
          </IconButton>
        )}
        {summonShortcut && (
          <span className="hoot-studio-sidebar__hint">
            <span className="hoot-visually-hidden">Summon Hoot with </span>
            <Kbd keys={summonShortcut} />
          </span>
        )}
      </div>
    </div>
  )
}
