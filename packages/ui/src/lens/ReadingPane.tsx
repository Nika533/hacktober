import type {
  LensMode,
  LensSettings,
  LensSettingsPatch,
  RetentionDays,
  SiteRule,
  StateSlices
} from '@hoot/core'
import { ArrowLeft, BookMarked, ChevronRight, ShieldCheck, UserRound, X } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { IconButton } from '../components/IconButton'
import { Segmented, type SegmentedOption } from '../components/Segmented'
import { Slider } from '../components/Slider'
import { Switch } from '../components/Switch'
import { TextField } from '../components/TextField'
import { useToast } from '../components/toastContext'
import { ExtensionStatus } from './ExtensionStatus'
import {
  COMMON_LANGUAGES,
  GEMINI_TERMS_URL,
  languageName,
  siteFromInput,
  siteLabel,
  sortedSites
} from './sites'

export interface ReadingPaneProps {
  lens: LensSettings
  /** The live link to the browser extension, when main serves the `lens` slice. */
  status?: Pick<StateSlices['lens'], 'bridge' | 'clients'>
  onUpdate: (patch: LensSettingsPatch) => void
  /** Studio pages about the reader: the profile and the glossary. */
  onOpenView: (view: 'profile' | 'glossary') => void
  /** Opens a link in the browser (`app.openExternal`). */
  onOpenLink: (url: string) => void
  onBack: () => void
  /** Clock for the consent timestamp (tests pin it). */
  now?: () => number
}

const MODES: SegmentedOption<LensMode>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'gloss', label: 'Gloss only' },
  { value: 'ask', label: 'Ask first' }
]

const MODE_NOTES: Record<LensMode, string> = {
  auto: 'Hoot rewrites text when you seem stuck. Every change is marked and undoes with one click.',
  gloss: 'Hoot keeps the original text and adds a short note next to it.',
  ask: 'Hoot offers a small chip next to your selection and changes nothing until you click it.'
}

const RULES: SegmentedOption<SiteRule>[] = [
  { value: 'always', label: 'Always on' },
  { value: 'paused', label: 'Paused' },
  { value: 'never', label: 'Never' }
]

const RETENTION: SegmentedOption<`${RetentionDays}`>[] = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '365 days' }
]

const sensitivityText = (v: number): string =>
  v < 0 ? 'Fewer changes' : v > 0 ? 'More changes' : 'Balanced'

/**
 * Studio → Reading: Hoot Lens consent, then how Lens helps, languages,
 * sites and history (hoot-lens.md §5.6, §11). Lens stays off until the user
 * reads what it sends and turns it on here. Every change saves at once.
 */
export function ReadingPane({
  lens,
  status,
  onUpdate,
  onOpenView,
  onOpenLink,
  onBack,
  now = Date.now
}: ReadingPaneProps): React.JSX.Element {
  const titleId = useId()
  const consented = lens.consentedAt !== null
  return (
    <section className="hoot-settings hoot-reading" aria-labelledby={titleId}>
      <header className="hoot-chat-pane__header hoot-studio-drag">
        <IconButton label="Back to chat" className="hoot-studio-no-drag" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <h1 id={titleId} className="hoot-chat-pane__title">
          Reading
        </h1>
      </header>
      <div className="hoot-settings__scroll">
        <Group title="Hoot Lens">
          {consented ? (
            <>
              <Switch
                label="Hoot Lens"
                description="Rewrites text you don’t understand, in your browser and in Hoot Reader."
                checked={lens.enabled}
                onChange={(enabled) => onUpdate({ enabled })}
              />
              {status && <ExtensionStatus bridge={status.bridge} clients={status.clients} />}
              <details className="hoot-reading__sent">
                <summary>What Lens sends, and when</summary>
                <DataTerms onOpenLink={onOpenLink} />
              </details>
            </>
          ) : (
            <Consent
              onAccept={() => onUpdate({ enabled: true, consentedAt: now() })}
              onOpenLink={onOpenLink}
            />
          )}
        </Group>

        <Group title="How Lens helps">
          <Segmented<LensMode>
            label="Mode"
            value={lens.mode}
            options={MODES}
            onChange={(mode) => onUpdate({ mode })}
          />
          <p className="hoot-settings__note">{MODE_NOTES[lens.mode]}</p>
          <Slider
            label="How often Hoot steps in"
            value={lens.sensitivity}
            min={-1}
            max={1}
            step={0.5}
            showValue={false}
            formatValue={sensitivityText}
            minLabel="Fewer changes"
            maxLabel="More changes"
            onChange={(sensitivity) => {
              if (sensitivity !== lens.sensitivity) onUpdate({ sensitivity })
            }}
          />
          <Segmented<LensSettings['highStakes']>
            label="Medical, legal and money pages"
            value={lens.highStakes}
            options={[
              { value: 'gloss', label: 'Gloss only' },
              { value: 'allow-replace', label: 'Allow rewrites' }
            ]}
            onChange={(highStakes) => onUpdate({ highStakes })}
          />
          <p className="hoot-settings__note">
            {lens.highStakes === 'gloss'
              ? 'On these pages Hoot keeps the original wording and adds a note beside it, because the original is what applies.'
              : 'Hoot may rewrite text on these pages too. Its note still says the original wording is what applies.'}
          </p>
          <Segmented<LensSettings['copyBehavior']>
            label="When you copy changed text"
            value={lens.copyBehavior}
            options={[
              { value: 'original', label: 'Copy the original' },
              { value: 'visible', label: 'Copy what I see' }
            ]}
            onChange={(copyBehavior) => onUpdate({ copyBehavior })}
          />
        </Group>

        <Group title="Languages">
          <Languages lens={lens} onUpdate={onUpdate} />
        </Group>

        <Group title="Sites">
          <Sites
            sites={lens.sites}
            onRule={(site, rule) => onUpdate({ sites: { [site]: rule } })}
            onRemove={(site) => onUpdate({ sites: { [site]: null } })}
          />
        </Group>

        <Group title="What Hoot remembers">
          <Segmented<`${RetentionDays}`>
            label="Keep reading history for"
            size="sm"
            value={`${lens.retentionDays}`}
            options={RETENTION}
            onChange={(v) => onUpdate({ retentionDays: Number(v) as RetentionDays })}
          />
          <p className="hoot-settings__note">
            Hoot keeps a log of the changes it made and how you reacted, so it learns what helps
            you. It stays on this PC, and older entries are deleted.
          </p>
          <nav className="hoot-reading__links" aria-label="Your reading profile">
            <LinkRow
              icon={<UserRound />}
              title="What Hoot knows about you"
              note="Words you know, topics you’re learning, how you like things explained."
              onClick={() => onOpenView('profile')}
            />
            <LinkRow
              icon={<BookMarked />}
              title="My glossary"
              note="Every term Hoot explained that you kept."
              onClick={() => onOpenView('glossary')}
            />
          </nav>
        </Group>
      </div>
    </section>
  )
}

/* Consent and data copy (hoot-lens.md §11), checked by C against the Gemini API terms. */
function DataTerms({ onOpenLink }: { onOpenLink: (url: string) => void }): React.JSX.Element {
  return (
    <dl className="hoot-reading__terms">
      <dt>Sent to Google Gemini</dt>
      <dd>
        The text you selected, its paragraph, the page title and headings, and a short summary of
        your reading profile: terms on this page you know or find hard, and your languages and
        style.
      </dd>
      <dt>When</dt>
      <dd>
        In Ask first mode, only after you click the chip. In Auto mode, also to check whether a
        selection needs help.
      </dd>
      <dt>Never sent</dt>
      <dd>
        Form fields, the rest of the page, cookies or full web addresses. Site rules keep only the
        site name, like example.com.
      </dd>
      <dt>Skipped</dt>
      <dd>
        Banking and payments, health portals, email and chat, password managers, any page with a
        password field, and private windows.
      </dd>
      <dt>Stays on this PC</dt>
      <dd>
        Your full reading profile, your glossary and the list of recent changes. Only the short
        summary above goes with a request.
      </dd>
      <dt>How Google uses it</dt>
      <dd>
        With a free Gemini API key, Google may use what Lens sends to improve its products, and
        people at Google may read it. With billing turned on, it doesn’t, and keeps requests only
        briefly to detect abuse.{' '}
        <a
          href={GEMINI_TERMS_URL}
          onClick={(e) => {
            e.preventDefault()
            onOpenLink(GEMINI_TERMS_URL)
          }}
        >
          Gemini API terms
        </a>
      </dd>
    </dl>
  )
}

function Consent({
  onAccept,
  onOpenLink
}: {
  onAccept: () => void
  onOpenLink: (url: string) => void
}): React.JSX.Element {
  return (
    <div className="hoot-reading__consent">
      <div className="hoot-reading__consent-head">
        <ShieldCheck aria-hidden />
        <p className="hoot-reading__consent-lede">
          Select text you don’t understand, and Hoot rewrites it in place, on web pages and in PDFs.
          Every change is marked and undoes with one click. Lens is off until you turn it on.
        </p>
      </div>
      <DataTerms onOpenLink={onOpenLink} />
      <div>
        <Button variant="primary" onClick={onAccept}>
          Turn on Hoot Lens
        </Button>
      </div>
    </div>
  )
}

function Languages({
  lens,
  onUpdate
}: {
  lens: LensSettings
  onUpdate: (patch: LensSettingsPatch) => void
}): React.JSX.Element {
  const id = useId()
  const { primary, comfortable } = lens.languages
  const offered = [...new Set<string>([...COMMON_LANGUAGES, primary, ...comfortable])]
  const others = offered.filter((l) => l !== primary)
  return (
    <>
      <div className="hoot-field">
        <label htmlFor={id} className="hoot-field__label">
          Your main language
        </label>
        <div className="hoot-field__control">
          <select
            id={id}
            className="hoot-field__input hoot-reading__select"
            value={primary}
            onChange={(e) => {
              const next = e.currentTarget.value
              onUpdate({
                languages: { primary: next, comfortable: comfortable.filter((l) => l !== next) }
              })
            }}
          >
            {offered.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div role="group" aria-labelledby={`${id}-ok`} className="hoot-reading__langs">
        <p id={`${id}-ok`} className="hoot-settings__label">
          Languages you read comfortably
        </p>
        <p className="hoot-settings__note">Hoot won’t translate text in these languages.</p>
        <div className="hoot-chip-row">
          {others.map((l) => {
            const on = comfortable.includes(l)
            return (
              <Chip
                key={l}
                selected={on}
                onClick={() =>
                  onUpdate({
                    languages: {
                      comfortable: on ? comfortable.filter((c) => c !== l) : [...comfortable, l]
                    }
                  })
                }
              >
                {languageName(l)}
              </Chip>
            )
          })}
        </div>
      </div>
    </>
  )
}

function Sites({
  sites,
  onRule,
  onRemove
}: {
  sites: Record<string, SiteRule>
  onRule: (site: string, rule: SiteRule) => void
  onRemove: (site: string) => void
}): React.JSX.Element {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [rule, setRule] = useState<SiteRule>('never')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const rows = sortedSites(sites)

  const add = (e: FormEvent): void => {
    e.preventDefault()
    const site = siteFromInput(draft)
    if (site === null) {
      setError('Enter a site like example.com.')
      return
    }
    onRule(site, rule)
    setDraft('')
    setError(null)
  }

  const remove = (site: string, current: SiteRule, button: HTMLElement): void => {
    // Keep focus in the list: the next row's Remove, else the previous one, else the input.
    const item = button.closest('li')
    const sibling = item?.nextElementSibling ?? item?.previousElementSibling
    ;(sibling?.querySelector<HTMLElement>('[data-remove]') ?? input.current)?.focus()
    onRemove(site)
    toast.show({
      message: `Removed ${siteLabel(site)}`,
      action: { label: 'Undo', onAction: () => onRule(site, current) }
    })
  }

  return (
    <>
      <p className="hoot-settings__note">
        Paused sites come back when you press Alt+H on the page. Never keeps Lens off a site. Always
        on keeps Lens running on sites Hoot skips by default.
      </p>
      <form className="hoot-reading__add" onSubmit={add} noValidate>
        <TextField
          ref={input}
          label="Add a site"
          placeholder="example.com"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          error={error}
          onChange={(e) => {
            setDraft(e.currentTarget.value)
            setError(null)
          }}
        />
        <div className="hoot-reading__add-row">
          <Segmented<SiteRule>
            label="Rule for the new site"
            hideLabel
            size="sm"
            value={rule}
            options={RULES}
            onChange={setRule}
          />
          <Button type="submit">Add</Button>
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="hoot-settings__note">
          No site rules yet. To pause Lens on a site, press Alt+H there or use the page pill.
        </p>
      ) : (
        <ul className="hoot-reading__sites" aria-label="Site rules">
          {rows.map(([site, current]) => (
            <li key={site} className="hoot-reading__site">
              <span className="hoot-reading__site-name">{siteLabel(site)}</span>
              <Segmented<SiteRule>
                label={`Lens on ${siteLabel(site)}`}
                hideLabel
                size="sm"
                value={current}
                options={RULES}
                onChange={(next) => onRule(site, next)}
              />
              <IconButton
                label={`Remove ${siteLabel(site)}`}
                size="sm"
                data-remove=""
                onClick={(e) => remove(site, current, e.currentTarget)}
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

function LinkRow({
  icon,
  title,
  note,
  onClick
}: {
  icon: ReactNode
  title: string
  note: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" className="hoot-reading__link" onClick={onClick}>
      <span className="hoot-reading__link-icon" aria-hidden>
        {icon}
      </span>
      <span className="hoot-reading__link-text">
        <span className="hoot-settings__label">{title}</span>
        <span className="hoot-settings__note">{note}</span>
      </span>
      <ChevronRight className="hoot-reading__link-chevron" aria-hidden />
    </button>
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
