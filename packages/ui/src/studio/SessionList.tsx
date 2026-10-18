import { groupSessions, type SessionMeta } from '@hoot/core'
import { Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../cx'

export interface SessionListProps {
  sessions: readonly SessionMeta[]
  activeId: string | null
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  /** The host shows the Undo toast (see StudioSidebar). */
  onDelete: (session: SessionMeta) => void
  /** Shown when the list is empty because of a search. */
  query?: string
  /** For grouping into Today / Yesterday / …; defaults to now. */
  now?: Date
  label?: string
  className?: string
}

/**
 * Chats grouped by recency. One row is in the tab order at a time (roving
 * focus): arrows, Home and End move between rows across groups, Enter opens,
 * F2 renames in place, Delete deletes. Double-click also renames. The open
 * chat is marked aria-current.
 */
export function SessionList({
  sessions,
  activeId,
  onOpen,
  onRename,
  onDelete,
  query,
  now,
  label = 'Chats',
  className
}: SessionListProps): React.JSX.Element {
  const hintId = useId()
  const groups = useMemo(() => groupSessions([...sessions], now ?? new Date()), [sessions, now])
  const order = useMemo(() => groups.flatMap((g) => g.items.map((m) => m.id)), [groups])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const refocus = useRef<string | null>(null)

  // The tabbable row: the one last focused, else the open chat, else the first.
  const tabId =
    (focusId && order.includes(focusId) ? focusId : null) ??
    (activeId && order.includes(activeId) ? activeId : null) ??
    order[0] ??
    null

  // After a delete or rename, put focus back where the user expects it.
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    const el = rows.current.get(id)
    if (el) {
      refocus.current = null
      el.focus()
    }
  })

  const move = (from: string, to: number): void => {
    const id = order[Math.max(0, Math.min(order.length - 1, to))]
    if (!id || id === from) return
    setFocusId(id)
    rows.current.get(id)?.focus()
  }

  const remove = (m: SessionMeta): void => {
    const i = order.indexOf(m.id)
    refocus.current = order[i + 1] ?? order[i - 1] ?? null
    onDelete(m)
  }

  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, m: SessionMeta): void => {
    const i = order.indexOf(m.id)
    switch (e.key) {
      case 'ArrowDown':
        move(m.id, i + 1)
        break
      case 'ArrowUp':
        move(m.id, i - 1)
        break
      case 'Home':
        move(m.id, 0)
        break
      case 'End':
        move(m.id, order.length - 1)
        break
      case 'F2':
        setRenaming(m.id)
        break
      case 'Delete':
        remove(m)
        break
      default:
        return
    }
    e.preventDefault()
  }

  if (sessions.length === 0) {
    return (
      <p className={cx('hoot-sessions__empty', className)}>
        {query ? `No chats match “${query}”.` : 'No chats yet. Start one with New chat.'}
      </p>
    )
  }

  return (
    <nav aria-label={label} className={cx('hoot-sessions', className)}>
      <span id={hintId} className="hoot-visually-hidden">
        Arrow keys move, F2 renames, Delete deletes.
      </span>
      {groups.map((g, gi) => (
        <div
          key={g.label}
          role="group"
          aria-labelledby={`${hintId}-g${gi}`}
          className="hoot-sessions__group"
        >
          <h3 id={`${hintId}-g${gi}`} className="hoot-sessions__heading hoot-chrome">
            {g.label}
          </h3>
          <ul>
            {g.items.map((m) => (
              <li key={m.id} className="hoot-session" data-active={m.id === activeId || undefined}>
                {renaming === m.id ? (
                  <RenameField
                    title={m.title}
                    onDone={(title) => {
                      setRenaming(null)
                      refocus.current = m.id
                      if (title !== null && title !== m.title) onRename(m.id, title)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) rows.current.set(m.id, el)
                      else rows.current.delete(m.id)
                    }}
                    className="hoot-session__open"
                    tabIndex={m.id === tabId ? 0 : -1}
                    aria-current={m.id === activeId ? 'page' : undefined}
                    aria-describedby={hintId}
                    aria-keyshortcuts="F2 Delete"
                    onFocus={() => setFocusId(m.id)}
                    onClick={() => onOpen(m.id)}
                    onDoubleClick={() => setRenaming(m.id)}
                    onKeyDown={(e) => onRowKey(e, m)}
                  >
                    <span className="hoot-session__title">{m.title || 'Untitled chat'}</span>
                  </button>
                )}
                {renaming !== m.id && (
                  <button
                    type="button"
                    className="hoot-session__delete"
                    tabIndex={-1}
                    aria-label={`Delete ${m.title || 'Untitled chat'}`}
                    onClick={() => remove(m)}
                  >
                    <Trash2 aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function RenameField({
  title,
  onDone
}: {
  title: string
  /** The trimmed new title, or null when cancelled / left empty. */
  onDone: (title: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (t: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(t)
  }
  return (
    <input
      className="hoot-session__rename"
      aria-label="Chat name"
      value={value}
      // Rename is an explicit user action, so taking focus is expected.
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value.trim() || null)
        else if (e.key === 'Escape') finish(null)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
      onBlur={() => finish(value.trim() || null)}
    />
  )
}
