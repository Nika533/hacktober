import type { GlossaryEntry } from '@hoot/core'
import { ArrowLeft, Check, Pin, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { Owl } from '../components/Owl'
import { TextField } from '../components/TextField'
import { useToast } from '../components/toastContext'
import { siteLabel } from './sites'
import { glossaryPinText, timeAgo } from './useLensPages'

export interface GlossaryPaneProps {
  /** Null while loading. */
  entries: GlossaryEntry[] | null
  failed?: boolean
  onRetry?: () => void
  /** Pin the entry as a sticky note (`pins.createFromText`). */
  onPin: (text: string) => Promise<void>
  onMarkKnown: (term: string) => Promise<void>
  onBack: () => void
  now?: number
}

/**
 * Studio → My glossary (hoot-lens.md §8.6): every term Lens defined or
 * expanded that the reader kept. Search, pin one as a sticky note, or mark
 * it known so Hoot stops explaining it.
 */
export function GlossaryPane({
  entries,
  failed = false,
  onRetry,
  onPin,
  onMarkKnown,
  onBack,
  now: nowProp
}: GlossaryPaneProps): React.JSX.Element {
  const titleId = useId()
  const toast = useToast()
  const [openedAt] = useState(Date.now)
  const now = nowProp ?? openedAt
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = (entries ?? []).filter(
    (e) => !q || e.term.toLowerCase().includes(q) || e.gloss.toLowerCase().includes(q)
  )
  const fail = (): void => {
    toast.show({ tone: 'danger', message: 'Hoot couldn’t do that. Try again.' })
  }

  return (
    <section className="hoot-settings hoot-glossary" aria-labelledby={titleId}>
      <header className="hoot-chat-pane__header hoot-studio-drag">
        <IconButton label="Back to Reading" className="hoot-studio-no-drag" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <h1 id={titleId} className="hoot-chat-pane__title">
          My glossary
        </h1>
      </header>
      <div className="hoot-settings__scroll">
        {failed ? (
          <div role="alert" className="hoot-profile__state">
            <p>Hoot couldn’t load your glossary.</p>
            {onRetry && <Button onClick={onRetry}>Try again</Button>}
          </div>
        ) : !entries ? (
          <p role="status" className="hoot-profile__state">
            Loading…
          </p>
        ) : entries.length === 0 ? (
          <div className="hoot-glossary__empty">
            <Owl mood="idle" size={64} />
            <p className="hoot-glossary__empty-title">Your glossary is empty</p>
            <p className="hoot-settings__note">
              When Lens explains a term and you keep it, the term lands here so you can review it
              later or pin it as a note.
            </p>
          </div>
        ) : (
          <div className="hoot-glossary__body">
            <TextField
              label="Search the glossary"
              hideLabel
              type="search"
              placeholder="Search the glossary"
              leading={<Search />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <p role="status" className="hoot-settings__note">
              {q
                ? `${shown.length} of ${entries.length} terms`
                : `${entries.length} ${entries.length === 1 ? 'term' : 'terms'}`}
            </p>
            <ul className="hoot-glossary__list">
              {shown.map((e) => (
                <li key={e.term} className="hoot-glossary__entry">
                  <div className="hoot-glossary__head">
                    <h2 className="hoot-glossary__term">{e.term}</h2>
                    {e.state === 'known' && (
                      <span className="hoot-glossary__badge">
                        <Check aria-hidden /> Known
                      </span>
                    )}
                  </div>
                  <p className="hoot-glossary__gloss">{e.gloss}</p>
                  <p className="hoot-settings__note">
                    Seen on {siteLabel(e.site)} · {timeAgo(e.lastSeen, now)}
                  </p>
                  <div className="hoot-glossary__actions">
                    <Button
                      size="sm"
                      icon={<Pin />}
                      onClick={() =>
                        void onPin(glossaryPinText(e)).then(
                          () => toast.show({ message: `Pinned “${e.term}” as a note` }),
                          fail
                        )
                      }
                    >
                      Pin as note
                    </Button>
                    {e.state !== 'known' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void onMarkKnown(e.term).catch(fail)}
                      >
                        I know this now
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
