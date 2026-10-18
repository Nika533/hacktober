import {
  ClipboardCopy,
  KeyRound,
  Maximize2,
  Pin,
  Plus,
  Search,
  Send,
  Square,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { IconButton } from '../components/IconButton'
import { Kbd } from '../components/Kbd'
import { Owl } from '../components/Owl'
import { OWL_MOODS } from '../components/owlMood'
import { Segmented } from '../components/Segmented'
import { Slider } from '../components/Slider'
import { Switch } from '../components/Switch'
import { TextField } from '../components/TextField'
import { useConfirm } from '../components/confirmContext'
import { useToast } from '../components/toastContext'
import { applyAccent, applyTheme, type ThemePreference } from '../theme'
import { ChatDemo } from './ChatDemo'
import { OnboardingDemo } from './OnboardingDemo'
import { SettingsDemo } from './SettingsDemo'
import { ShortcutsDemo } from './ShortcutsDemo'
import { StudioDemo } from './StudioDemo'
import './gallery.css'

type ModelChoice = 'flash-lite' | 'flash' | 'argon'
type AccentChoice = 'default' | '0078d4' | 'ca5010' | '107c10' | '9a0089'

const ACCENTS: { value: AccentChoice; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: '0078d4', label: 'Blue' },
  { value: 'ca5010', label: 'Orange' },
  { value: '107c10', label: 'Green' },
  { value: '9a0089', label: 'Orchid' }
]

const MATERIALS = [
  { name: 'chrome', title: 'Chrome', use: 'Studio sidebar' },
  { name: 'pane', title: 'Pane', use: 'Studio content over Mica' },
  { name: 'card', title: 'Card', use: 'Buddy card' },
  { name: 'popover', title: 'Popover', use: 'Menus and toasts' }
] as const

const SWATCHES = [
  'text-1',
  'text-2',
  'text-3',
  'accent',
  'accent-text',
  'accent-subtle',
  'surface',
  'surface-raised',
  'fill-sunken',
  'stroke-strong',
  'danger',
  'success',
  'warning'
] as const

export interface GalleryProps {
  initialTheme?: ThemePreference
  initialAccent?: string
}

/** Every @hoot/ui component in its real Hoot context, for review and screenshots. */
export function Gallery({
  initialTheme = 'system',
  initialAccent = 'default'
}: GalleryProps): React.JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [theme, setTheme] = useState<ThemePreference>(initialTheme)
  const [accent, setAccent] = useState<AccentChoice>(
    ACCENTS.some((a) => a.value === initialAccent) ? (initialAccent as AccentChoice) : 'default'
  )
  const [model, setModel] = useState<ModelChoice>('flash')
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  const [saveHistory, setSaveHistory] = useState(true)
  const [clipHint, setClipHint] = useState(true)
  const [key, setKey] = useState('AIzaSy-not-a-real-key')
  const [showKey, setShowKey] = useState(false)
  const [validating, setValidating] = useState(false)
  const [sensitivity, setSensitivity] = useState(50)
  const [collapse, setCollapse] = useState(5)
  const [pinned, setPinned] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('Quarterly revenue chart')

  return (
    <div className="gallery">
      <header className="gallery__header">
        <Owl mood="idle" size={44} label="Hoot" />
        <div className="gallery__heading">
          <h1 className="hoot-t-title">Hoot UI</h1>
          <p className="hoot-t-body hoot-t-secondary">
            Tokens, materials and components shared by Studio, the Buddy and the Reader.
          </p>
        </div>
        <div className="gallery__controls">
          <Segmented
            label="Theme"
            size="sm"
            value={theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
            onChange={(t) => {
              setTheme(t)
              applyTheme(t)
            }}
          />
          <Segmented
            label="Accent"
            size="sm"
            value={accent}
            options={ACCENTS}
            onChange={(a) => {
              setAccent(a)
              applyAccent(a === 'default' ? null : a)
            }}
          />
        </div>
      </header>

      <main className="gallery__grid">
        <Section title="Owl" wide>
          <div className="gallery__owls">
            {OWL_MOODS.map((m) => (
              <figure key={m} className="gallery__owl">
                <Owl mood={m} size={64} />
                <figcaption className="hoot-t-caption hoot-t-secondary">{m}</figcaption>
              </figure>
            ))}
          </div>
        </Section>

        <Section title="Studio" wide>
          <StudioDemo />
        </Section>

        <Section title="Studio settings" wide>
          <SettingsDemo />
        </Section>

        <Section title="Onboarding" wide>
          <OnboardingDemo />
        </Section>

        <Section title="Chat" wide>
          <ChatDemo />
        </Section>

        <Section title="Buttons">
          <div className="gallery__row">
            <Button variant="primary" icon={<Send />}>
              Send
            </Button>
            <Button
              busy={validating}
              icon={<KeyRound />}
              onClick={() => {
                setValidating(true)
                setTimeout(() => setValidating(false), 1500)
              }}
            >
              {validating ? 'Checking key' : 'Check key'}
            </Button>
            <Button variant="ghost">Not now</Button>
            <Button variant="danger" icon={<Trash2 />}>
              Delete chat
            </Button>
          </div>
          <div className="gallery__row">
            <Button size="sm" variant="primary">
              Explain
            </Button>
            <Button size="sm">Summarize</Button>
            <Button size="sm" variant="ghost">
              Translate
            </Button>
            <Button size="sm" disabled>
              Disabled
            </Button>
          </div>
        </Section>

        <Section title="Icon buttons">
          <div className="gallery__row">
            <IconButton label="New chat" shortcut="Ctrl+N">
              <Plus />
            </IconButton>
            <IconButton label="Open in Studio" shortcut="Ctrl+L">
              <Maximize2 />
            </IconButton>
            <IconButton label="Copy answer">
              <ClipboardCopy />
            </IconButton>
            <IconButton
              label="Pin as note"
              aria-pressed={pinned}
              onClick={() => setPinned((p) => !p)}
            >
              <Pin />
            </IconButton>
            <IconButton label="Stop answering" variant="accent">
              <Square />
            </IconButton>
            <IconButton label="Small copy" size="sm">
              <ClipboardCopy />
            </IconButton>
          </div>
          <p className="hoot-t-caption hoot-t-secondary">
            Hover or Tab to a button for its tooltip and shortcut.
          </p>
        </Section>

        <Section title="Segmented">
          <Segmented
            label="Model"
            value={model}
            onChange={setModel}
            options={[
              { value: 'flash-lite', label: 'Flash-Lite', hint: 'fastest' },
              { value: 'flash', label: 'Flash' },
              { value: 'argon', label: 'Argon', hint: 'paid tier' }
            ]}
          />
          <Segmented
            label="History retention"
            size="sm"
            value="90"
            onChange={() => undefined}
            options={[
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '365 days', disabled: true }
            ]}
          />
        </Section>

        <Section title="Switches">
          <div className="gallery__stack">
            <Switch label="Launch at login" checked={launchAtLogin} onChange={setLaunchAtLogin} />
            <Switch
              label="Save chat history"
              description="Chats stay on this PC. Turn off to forget each chat when you close it."
              checked={saveHistory}
              onChange={setSaveHistory}
            />
            <Switch
              label="Suggest copied text"
              description="Shows a chip for what you just copied. It never sends on its own."
              checked={clipHint}
              onChange={setClipHint}
            />
            <Switch label="Restore pinned notes" checked disabled onChange={() => undefined} />
          </div>
        </Section>

        <Section title="Text fields">
          <TextField
            label="Gemini API key"
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.currentTarget.value)}
            autoComplete="off"
            spellCheck={false}
            description="Get a free key at aistudio.google.com/apikey. It's stored encrypted on this PC."
            trailing={
              <Button size="sm" variant="ghost" onClick={() => setShowKey((s) => !s)}>
                {showKey ? 'Hide' : 'Show'}
              </Button>
            }
          />
          <TextField
            label="Gemini API key (rejected)"
            defaultValue="AIzaSy-expired"
            error="Google rejected this key. Check it was copied in full, or create a new one."
          />
          <TextField
            label="Search chats"
            hideLabel
            placeholder="Search chats"
            leading={<Search />}
          />
        </Section>

        <Section title="Sliders">
          <Slider
            label="Sensitivity"
            value={sensitivity}
            onChange={setSensitivity}
            showValue={false}
            formatValue={(v) => (v < 34 ? 'Fewer changes' : v > 66 ? 'More changes' : 'Balanced')}
            minLabel="Fewer changes"
            maxLabel="More changes"
          />
          <Slider
            label="Shrink to a dot after"
            value={collapse}
            min={2}
            max={30}
            onChange={setCollapse}
            formatValue={(v) => `${v} s`}
          />
        </Section>

        <Section title="Feedback">
          <div className="gallery__row">
            <Button
              icon={<Trash2 />}
              onClick={() =>
                toast.show({
                  message: 'Chat deleted',
                  action: { label: 'Undo', onAction: () => undefined }
                })
              }
            >
              Delete with undo
            </Button>
            <Button
              onClick={() =>
                toast.show({
                  tone: 'danger',
                  message: "Couldn't reach Gemini. Check your connection and try again."
                })
              }
            >
              Show an error
            </Button>
          </div>
          <div className="gallery__row">
            <Button
              variant="danger"
              onClick={() =>
                void confirm({
                  title: 'Clear all data?',
                  body: 'Deletes every chat, pinned note and setting on this PC. Your API key stays. This can’t be undone.',
                  confirmLabel: 'Clear all data',
                  tone: 'danger'
                }).then((ok) => {
                  if (ok) toast.show({ message: 'All data cleared' })
                })
              }
            >
              Clear all data…
            </Button>
            <Button onClick={() => setRenaming(true)}>Rename chat…</Button>
          </div>
          <Dialog
            open={renaming}
            onClose={() => setRenaming(false)}
            title="Rename chat"
            actions={
              <>
                <Button variant="primary" onClick={() => setRenaming(false)}>
                  Rename
                </Button>
                <Button onClick={() => setRenaming(false)}>Cancel</Button>
              </>
            }
          >
            <TextField
              label="Chat name"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              data-autofocus
            />
          </Dialog>
        </Section>

        <Section title="Shortcuts">
          <ShortcutsDemo />
        </Section>

        <Section title="Keyboard">
          <dl className="gallery__keys">
            <dt>Summon Hoot</dt>
            <dd>
              <Kbd keys="Ctrl+Shift+Space" />
            </dd>
            <dt>Circle anything</dt>
            <dd>
              <Kbd keys="Ctrl+Alt+Space" />
            </dd>
            <dt>Open in Studio</dt>
            <dd>
              <Kbd keys="Ctrl+L" />
            </dd>
          </dl>
        </Section>

        <Section title="Materials" wide>
          <div className="gallery__materials">
            {MATERIALS.map((m) => (
              <div key={m.name} className={`gallery__mat hoot-material hoot-material--${m.name}`}>
                <strong>{m.title}</strong>
                <span className="hoot-t-caption hoot-t-secondary">{m.use}</span>
              </div>
            ))}
            <div className="gallery__chip hoot-material hoot-material--chip">Chip</div>
          </div>
        </Section>

        <Section title="Type">
          <div className="gallery__type">
            <p className="hoot-t-display">Hoot</p>
            <p className="hoot-t-title">Good evening</p>
            <p className="hoot-t-subtitle">What can I help with?</p>
            <p className="hoot-t-body-lg">Circle anything on screen and ask about it.</p>
            <p className="hoot-t-body">
              Answers stream in as Gemini writes them. Select any of this text to copy it.
            </p>
            <p className="hoot-t-caption hoot-t-secondary">Updated 2 minutes ago</p>
            <p className="hoot-t-mono">const owl = await hoot.summon()</p>
          </div>
        </Section>

        <Section title="Colour tokens">
          <ul className="gallery__swatches">
            {SWATCHES.map((s) => (
              <li key={s}>
                <span className="gallery__swatch" data-token={s} aria-hidden />
                <code className="hoot-t-caption">--{s}</code>
              </li>
            ))}
          </ul>
        </Section>
      </main>
    </div>
  )
}

function Section({
  title,
  wide = false,
  children
}: {
  title: string
  wide?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={wide ? 'gallery__section gallery__section--wide' : 'gallery__section'}>
      <h2 className="hoot-t-body-strong">{title}</h2>
      {children}
    </section>
  )
}
