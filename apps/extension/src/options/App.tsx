import {
  DEFAULT_SETTINGS,
  type LensBackend,
  type LensMode,
  type LensSettings,
  type LensSettingsPatch,
  type SiteRule
} from '@hoot/core'
import { applySettingsPatch } from '@hoot/core/schemas'
import {
  Button,
  IconButton,
  Owl,
  Segmented,
  Switch,
  TextField,
  useToast,
  type SegmentedOption
} from '@hoot/ui'
import { X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { normalizeSite, siteLabel, sortedSites } from './sites'

export type SettingsSource = Pick<LensBackend, 'getSettings' | 'patchSettings' | 'onSettings'>

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

/** The extension's options page: Lens on/off, mode and the per-site rules (spec §5.6). */
export function OptionsApp({ source }: { source: SettingsSource }): React.JSX.Element {
  const toast = useToast()
  const [settings, setSettings] = useState<LensSettings | null>(null)
  const [failed, setFailed] = useState(false)
  const pending = useRef(0)

  const load = useCallback((): void => {
    source.getSettings().then(setSettings, () => setFailed(true))
  }, [source])

  const reload = (): void => {
    setFailed(false)
    load()
  }

  useEffect(() => {
    load()
    return source.onSettings((lens) => {
      if (pending.current === 0) setSettings(lens)
    })
  }, [source, load])

  const update = async (patch: LensSettingsPatch): Promise<boolean> => {
    pending.current += 1
    setSettings(
      (s) => s && applySettingsPatch({ ...DEFAULT_SETTINGS, lens: s }, { lens: patch }).lens
    )
    try {
      const lens = await source.patchSettings(patch)
      if (pending.current === 1) setSettings(lens)
      return true
    } catch {
      toast.show({ message: 'Couldn’t save that change. Try again.', tone: 'danger' })
      reload()
      return false
    } finally {
      pending.current -= 1
    }
  }

  return (
    <main className="hoot-options">
      <header className="hoot-options__header">
        <Owl mood="idle" size={48} />
        <div>
          <h1 className="hoot-options__title hoot-t-title">Hoot Lens</h1>
          <p className="hoot-options__lede hoot-t-body">
            Select text you don’t understand and Hoot rewrites it in place. Reading preferences,
            what Hoot knows about you and your glossary live in Hoot Studio.
          </p>
        </div>
      </header>
      {failed ? (
        <div role="alert" className="hoot-options__error">
          <p className="hoot-t-body">Couldn’t load your Lens settings.</p>
          <Button onClick={reload}>Try again</Button>
        </div>
      ) : (
        settings && (
          <>
            <Group title="Reading">
              <Switch
                label="Lens"
                description="Turns Lens on or off on every site."
                checked={settings.enabled}
                disabled={settings.consentedAt === null}
                onChange={(enabled) => void update({ enabled })}
              />
              {settings.consentedAt === null && (
                <p className="hoot-options__note hoot-options__consent">
                  Turn Lens on in Hoot Studio first. It shows what Lens sends and when.
                </p>
              )}
              <Segmented<LensMode>
                label="Mode"
                className="hoot-options__mode"
                value={settings.mode}
                options={MODES}
                onChange={(mode) => void update({ mode })}
              />
              <p className="hoot-options__note">{MODE_NOTES[settings.mode]}</p>
            </Group>
            <Sites
              sites={settings.sites}
              onRule={(site, rule) => void update({ sites: { [site]: rule } })}
              onRemove={async (site, rule) => {
                if (!(await update({ sites: { [site]: null } }))) return
                toast.show({
                  message: `Removed ${siteLabel(site)}`,
                  action: {
                    label: 'Undo',
                    onAction: () => void update({ sites: { [site]: rule } })
                  }
                })
              }}
            />
          </>
        )
      )}
    </main>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  const id = useId()
  return (
    <section className="hoot-options__group" aria-labelledby={id}>
      <h2 id={id} className="hoot-options__heading">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface SitesProps {
  sites: Record<string, SiteRule>
  onRule: (site: string, rule: SiteRule) => void
  onRemove: (site: string, rule: SiteRule) => void
}

function Sites({ sites, onRule, onRemove }: SitesProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [rule, setRule] = useState<SiteRule>('never')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const rows = sortedSites(sites)

  const add = (event: FormEvent): void => {
    event.preventDefault()
    const site = normalizeSite(draft)
    if (site === null) {
      setError('Enter a site like example.com.')
      return
    }
    onRule(site, rule)
    setDraft('')
    setError(null)
  }

  const remove = (site: string, current: SiteRule, button: HTMLElement): void => {
    const item = button.closest('li')
    const sibling = item?.nextElementSibling ?? item?.previousElementSibling
    ;(sibling?.querySelector<HTMLElement>('[data-remove]') ?? input.current)?.focus()
    onRemove(site, current)
  }

  return (
    <Group title="Sites">
      <p className="hoot-options__note">
        Paused sites come back when you press Alt+H on the page. Never keeps Lens off a site. Always
        on keeps Lens running on sites Hoot skips by default.
      </p>
      <form className="hoot-options__add" onSubmit={add} noValidate>
        <TextField
          ref={input}
          label="Add a site"
          placeholder="example.com"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          error={error}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
            setError(null)
          }}
        />
        <div className="hoot-options__add-row">
          <Segmented<SiteRule>
            label="Rule for the new site"
            hideLabel
            size="sm"
            value={rule}
            options={RULES}
            onChange={setRule}
          />
          <Button type="submit" variant="primary">
            Add
          </Button>
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="hoot-options__note">
          No site rules yet. To pause Lens on a site, press Alt+H there or use the page pill.
        </p>
      ) : (
        <ul className="hoot-options__sites" aria-label="Site rules">
          {rows.map(([site, current]) => (
            <li key={site} className="hoot-options__site">
              <span className="hoot-options__site-name">{siteLabel(site)}</span>
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
                onClick={(event) => remove(site, current, event.currentTarget)}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Group>
  )
}
