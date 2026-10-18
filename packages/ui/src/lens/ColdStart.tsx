import type { ReaderProfile } from '@hoot/core'
import { Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { Segmented } from '../components/Segmented'
import { Switch } from '../components/Switch'
import { COLD_START_TOPICS, type ColdStartSetup } from './coldStartSetup'

export interface ColdStartProps {
  /** Saves the setup; the card disappears once main marks the cold start done. */
  onFinish: (setup: ColdStartSetup) => Promise<void>
}

/**
 * The optional 30-second setup (hoot-lens.md §8.4): topics you know well and
 * how you like things explained. Collapsed to one line until asked for, so
 * it never stands between the user and the settings below. Without it, Lens
 * starts cautious (Ask first for the first ten times) and learns as it goes.
 */
export function ColdStart({ onFinish }: ColdStartProps): React.JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [topics, setTopics] = useState<string[]>([])
  const [style, setStyle] = useState<ReaderProfile['style']>({
    length: 'same',
    plainWords: true,
    analogies: false
  })
  const [saving, setSaving] = useState(false)

  if (!open)
    return (
      <div className="hoot-coldstart hoot-coldstart--closed">
        <Sparkles aria-hidden />
        <div className="hoot-coldstart__text">
          <p className="hoot-settings__label">Teach Hoot what you already know</p>
          <p className="hoot-settings__note">
            About 30 seconds. Until then, Lens asks before changing anything.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Start
        </Button>
      </div>
    )

  const toggle = (t: string): void =>
    setTopics((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))

  return (
    <section className="hoot-coldstart" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="hoot-coldstart__title">
        Teach Hoot what you already know
      </h3>
      <div role="group" aria-labelledby={`${id}-topics`} className="hoot-coldstart__part">
        <p id={`${id}-topics`} className="hoot-settings__label">
          Topics you know well
        </p>
        <p className="hoot-settings__note">Hoot explains less on these.</p>
        <div className="hoot-chip-row">
          {COLD_START_TOPICS.map((t) => (
            <Chip key={t.key} selected={topics.includes(t.key)} onClick={() => toggle(t.key)}>
              {t.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="hoot-coldstart__part">
        <Segmented<ReaderProfile['style']['length']>
          label="Rewrites"
          size="sm"
          value={style.length}
          options={[
            { value: 'shorter', label: 'Shorter' },
            { value: 'same', label: 'About the same length' }
          ]}
          onChange={(length) => setStyle((s) => ({ ...s, length }))}
        />
        <Switch
          label="Plain words"
          checked={style.plainWords}
          onChange={(plainWords) => setStyle((s) => ({ ...s, plainWords }))}
        />
        <Switch
          label="Examples and analogies"
          checked={style.analogies}
          onChange={(analogies) => setStyle((s) => ({ ...s, analogies }))}
        />
      </div>
      <p className="hoot-settings__note">Your languages are under Languages below.</p>
      <div className="hoot-coldstart__actions">
        <Button
          variant="primary"
          busy={saving}
          onClick={() => {
            setSaving(true)
            void onFinish({ topics, style }).finally(() => setSaving(false))
          }}
        >
          Done
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Not now
        </Button>
      </div>
    </section>
  )
}
