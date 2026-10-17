import { Plus, Search, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppState, SessionMeta } from '../../../shared/types'
import { groupSessions } from '../../../shared/sessions'
import { Owl } from '../shared/Owl'
import { IconButton } from '../shared/ui/IconButton'

function SessionRow({
  meta,
  active,
  onDelete
}: {
  meta: SessionMeta
  active: boolean
  onDelete: () => void
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [value, setValue] = useState(meta.title)

  const commit = (): void => {
    setRenaming(false)
    const t = value.trim()
    if (t && t !== meta.title) window.hoot.sessions.rename(meta.id, t)
    else setValue(meta.title)
  }

  return (
    <div
      className={`sess-row ${active ? 'active' : ''}`}
      onClick={() => window.hoot.sessions.open(meta.id)}
      onDoubleClick={() => {
        setValue(meta.title)
        setRenaming(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          setValue(meta.title)
          setRenaming(true)
        }
      }}
      tabIndex={0}
    >
      {renaming ? (
        <input
          className="sess-rename t-body"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <span className="sess-title t-body" title={meta.title}>
          {meta.title}
        </span>
      )}
      <button
        type="button"
        className="sess-trash"
        aria-label="Delete chat"
        title="Delete chat"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export function Sidebar({ state }: { state: AppState }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<SessionMeta | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )

  const metas = query.trim()
    ? state.sessions.filter((m) => m.title.toLowerCase().includes(query.trim().toLowerCase()))
    : state.sessions
  const groups = groupSessions(metas, new Date())

  const onDelete = (m: SessionMeta): void => {
    window.hoot.sessions.delete(m.id)
    setToast(m)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  const undo = (): void => {
    if (toast) window.hoot.sessions.undoDelete(toast.id)
    setToast(null)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-drag drag">
        <Owl mood="idle" size={24} />
        <span className="t-title">Hoot</span>
      </div>
      <div className="sidebar-top">
        <button
          type="button"
          className="newchat-btn t-body"
          onClick={() => window.hoot.sessions.new()}
        >
          <Plus size={15} /> New chat
        </button>
        <div className="search-box">
          <Search size={13} />
          <input
            className="t-body"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="session-list">
        {groups.map((g) => (
          <div key={g.label} className="sess-group">
            <div className="sess-group-label t-small">{g.label}</div>
            {g.items.map((m) => (
              <SessionRow
                key={m.id}
                meta={m}
                active={state.activeSession?.id === m.id}
                onDelete={() => onDelete(m)}
              />
            ))}
          </div>
        ))}
      </div>
      {toast ? (
        <div className="toast t-small">
          <span>Chat deleted</span>
          <button type="button" onClick={undo}>
            Undo
          </button>
        </div>
      ) : null}
      <div className="sidebar-foot">
        <IconButton label="Settings" onClick={() => window.hoot.windows.openSettings()}>
          <Settings2 size={16} />
        </IconButton>
        <span className="t-small sidebar-hint">Ctrl+Shift+Space</span>
      </div>
    </aside>
  )
}
