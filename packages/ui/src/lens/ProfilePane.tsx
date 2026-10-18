import {
  TRANSFORM_RULES,
  type ProfilePatch,
  type ProfileView,
  type RecentChange,
  type ReaderProfile,
  type TermState
} from '@hoot/core'
import { ArrowLeft, X } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { useConfirm } from '../components/confirmContext'
import { IconButton } from '../components/IconButton'
import { Segmented, type SegmentedOption } from '../components/Segmented'
import { Slider } from '../components/Slider'
import { Switch } from '../components/Switch'
import { TextField } from '../components/TextField'
import { useToast } from '../components/toastContext'
import { siteLabel } from './sites'
import { timeAgo } from './useLensPages'

export interface ProfilePaneProps {
  /** Null while loading. */
  profile: ProfileView | null
  changes: RecentChange[] | null
  failed?: boolean
  onRetry?: () => void
  onPatch: (patch: ProfilePatch) => Promise<void>
  /** Save dialog; resolves with the written path, or null when cancelled. */
  onExport: () => Promise<string | null>
  onReset: () => Promise<void>
  onBack: () => void
  now?: number
}

type Filter = 'all' | TermState

const STATES: SegmentedOption<TermState>[] = [
  { value: 'known', label: 'Known' },
  { value: 'learning', label: 'Learning' },
  { value: 'unknown', label: 'New' }
]

const fail = (toast: ReturnType<typeof useToast>) => (): void => {
  toast.show({ tone: 'danger', message: 'Hoot couldn’t save that. Try again.' })
}

/**
 * Studio → What Hoot knows about you (hoot-lens.md §8): the summary Hoot
 * sends with each request, style preferences, words and topics (each
 * editable), Recent changes with the original text, export and reset.
 */
export function ProfilePane({
  profile: view,
  changes,
  failed = false,
  onRetry,
  onPatch,
  onExport,
  onReset,
  onBack,
  now: nowProp
}: ProfilePaneProps): React.JSX.Element {
  const titleId = useId()
  const [openedAt] = useState(Date.now)
  const now = nowProp ?? openedAt
  const toast = useToast()
  const confirm = useConfirm()
  const patch = (p: ProfilePatch): void => void onPatch(p).catch(fail(toast))

  return (
    <section className="hoot-settings hoot-profile" aria-labelledby={titleId}>
      <header className="hoot-chat-pane__header hoot-studio-drag">
        <IconButton label="Back to Reading" className="hoot-studio-no-drag" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <h1 id={titleId} className="hoot-chat-pane__title">
          What Hoot knows about you
        </h1>
      </header>
      <div className="hoot-settings__scroll">
        {failed ? (
          <div role="alert" className="hoot-profile__state">
            <p>Hoot couldn’t load your reading profile.</p>
            {onRetry && <Button onClick={onRetry}>Try again</Button>}
          </div>
        ) : !view ? (
          <p role="status" className="hoot-profile__state">
            Loading…
          </p>
        ) : (
          <>
            <Group title="How Hoot describes you">
              <p className="hoot-settings__note">
                Hoot adds this to each Lens request, trimmed to what matters for the page. Change
                anything below and it updates.
              </p>
              <pre className="hoot-profile__summary">{view.summary}</pre>
            </Group>

            <Group title="How you like things explained">
              <Segmented<ReaderProfile['style']['length']>
                label="Rewrites"
                value={view.profile.style.length}
                options={[
                  { value: 'shorter', label: 'Shorter' },
                  { value: 'same', label: 'About the same length' }
                ]}
                onChange={(length) => patch({ style: { length } })}
              />
              <Switch
                label="Plain words"
                description="Everyday words instead of technical ones, where possible."
                checked={view.profile.style.plainWords}
                onChange={(plainWords) => patch({ style: { plainWords } })}
              />
              <Switch
                label="Analogies"
                description="Compare new ideas to familiar things."
                checked={view.profile.style.analogies}
                onChange={(analogies) => patch({ style: { analogies } })}
              />
            </Group>

            <Group title="Words">
              <Terms terms={view.profile.terms} onPatch={patch} />
            </Group>

            <Group title="Topics">
              <Topics topics={view.profile.topics} onPatch={patch} />
            </Group>

            <Group title="Recent changes">
              <Changes changes={changes ?? []} now={now} />
            </Group>

            <Group title="Your data">
              <div className="hoot-settings__row">
                <div>
                  <p className="hoot-settings__label">Export</p>
                  <p className="hoot-settings__note">
                    Save your profile, Recent changes and glossary as a JSON file.
                  </p>
                </div>
                <Button
                  onClick={() =>
                    void onExport().then(
                      (path) => path && toast.show({ message: `Saved to ${path}` }),
                      fail(toast)
                    )
                  }
                >
                  Export…
                </Button>
              </div>
              <div className="hoot-settings__row">
                <div>
                  <p className="hoot-settings__label">Start over</p>
                  <p className="hoot-settings__note">
                    Forget the words, topics and preferences Hoot learned.
                  </p>
                </div>
                <Button
                  variant="danger"
                  onClick={() =>
                    void confirm({
                      title: 'Reset what Hoot knows about you?',
                      body: 'Hoot forgets the words, topics and preferences it learned, Recent changes and your glossary. Your Reading settings stay. This can’t be undone.',
                      confirmLabel: 'Reset',
                      tone: 'danger'
                    }).then((ok) => {
                      if (ok)
                        void onReset().then(
                          () => toast.show({ message: 'Your reading profile was reset' }),
                          fail(toast)
                        )
                    })
                  }
                >
                  Reset…
                </Button>
              </div>
            </Group>
          </>
        )}
      </div>
    </section>
  )
}

function Terms({
  terms,
  onPatch
}: {
  terms: ReaderProfile['terms']
  onPatch: (p: ProfilePatch) => void
}): React.JSX.Element {
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [draft, setDraft] = useState('')
  const all = Object.entries(terms).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const count = (s: TermState): number => all.filter(([, t]) => t.state === s).length
  const shown = filter === 'all' ? all : all.filter(([, t]) => t.state === filter)

  const add = (e: FormEvent): void => {
    e.preventDefault()
    const term = draft.trim()
    if (!term) return
    onPatch({ terms: { [term]: 'known' } })
    setDraft('')
  }

  return (
    <>
      <p className="hoot-settings__note">
        Known words are never explained. Hoot moves words here as you mark changes “I knew this” or
        keep an explanation.
      </p>
      <form className="hoot-profile__add" onSubmit={add}>
        <TextField
          label="Add a word you already know"
          placeholder="e.g. latency"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
        />
        <Button type="submit" disabled={!draft.trim()}>
          Add
        </Button>
      </form>
      {all.length > 0 && (
        <Segmented<Filter>
          label="Show"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${all.length}` },
            { value: 'known', label: `Known ${count('known')}` },
            { value: 'learning', label: `Learning ${count('learning')}` },
            { value: 'unknown', label: `New ${count('unknown')}` }
          ]}
        />
      )}
      {shown.length === 0 ? (
        <p className="hoot-settings__note">
          {all.length === 0 ? 'No words yet.' : 'No words in this group.'}
        </p>
      ) : (
        <ul className="hoot-profile__list" aria-label="Words">
          {shown.map(([term, t]) => (
            <li key={term} className="hoot-profile__item">
              <span className="hoot-profile__name">{term}</span>
              <Segmented<TermState>
                label={`How well you know “${term}”`}
                hideLabel
                size="sm"
                value={t.state}
                options={STATES}
                onChange={(state) => onPatch({ terms: { [term]: state } })}
              />
              <IconButton
                label={`Forget “${term}”`}
                size="sm"
                onClick={() => {
                  onPatch({ terms: { [term]: null } })
                  toast.show({
                    message: `Forgot “${term}”`,
                    action: {
                      label: 'Undo',
                      onAction: () => onPatch({ terms: { [term]: t.state } })
                    }
                  })
                }}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Topics({
  topics,
  onPatch
}: {
  topics: ReaderProfile['topics']
  onPatch: (p: ProfilePatch) => void
}): React.JSX.Element {
  const toast = useToast()
  const rows = Object.entries(topics).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  if (rows.length === 0)
    return <p className="hoot-settings__note">Topics show up here as you read.</p>
  return (
    <ul className="hoot-profile__list" aria-label="Topics">
      {rows.map(([topic, t]) => (
        <li key={topic} className="hoot-profile__item hoot-profile__item--topic">
          <Slider
            className="hoot-profile__topic"
            label={topic}
            value={Math.round(t.familiarity * 10) / 10}
            min={0}
            max={1}
            step={0.1}
            showValue={false}
            formatValue={(v) => (v >= 0.7 ? 'Know it well' : v >= 0.4 ? 'Somewhat' : 'New to me')}
            minLabel="New to me"
            maxLabel="Know it well"
            onChange={(familiarity) => onPatch({ topics: { [topic]: familiarity } })}
          />
          <IconButton
            label={`Forget “${topic}”`}
            size="sm"
            onClick={() => {
              onPatch({ topics: { [topic]: null } })
              toast.show({
                message: `Forgot “${topic}”`,
                action: {
                  label: 'Undo',
                  onAction: () => onPatch({ topics: { [topic]: t.familiarity } })
                }
              })
            }}
          >
            <X />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}

function Changes({ changes, now }: { changes: RecentChange[]; now: number }): React.JSX.Element {
  if (changes.length === 0)
    return (
      <p className="hoot-settings__note">
        Nothing yet. Every change Lens makes on a page shows up here with the original text.
      </p>
    )
  return (
    <ol className="hoot-profile__changes" aria-label="Recent changes">
      {changes.map((c) => (
        <li key={c.id} className="hoot-profile__change">
          <p className="hoot-profile__change-meta">
            {TRANSFORM_RULES[c.transform].label}
            {c.action === 'gloss' ? ' (note)' : ''} · {siteLabel(c.site)} ·{' '}
            <time dateTime={new Date(c.ts).toISOString()}>{timeAgo(c.ts, now)}</time>
          </p>
          <p className="hoot-profile__change-original">
            <span className="hoot-visually-hidden">Original: </span>
            {c.original}
          </p>
          <p className="hoot-profile__change-rewrite">
            <span className="hoot-visually-hidden">Hoot’s version: </span>
            {c.rewrite}
          </p>
        </li>
      ))}
    </ol>
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
