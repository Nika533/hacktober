import type { ApiKeyResult, Settings, SettingsPatch, StateSlices } from '@hoot/core'
import { BookOpenText, Keyboard, Lasso, Pin } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Kbd } from '../components/Kbd'
import { Owl } from '../components/Owl'
import { ExtensionStatus } from '../lens/ExtensionStatus'
import { springs } from '../motion/springs'
import { acceleratorKeys } from '../settings/accelerator'
import { GEMINI_TERMS_URL } from '../lens/sites'
import { ApiKeyField } from '../settings/ApiKeyField'
import { ShortcutFields } from '../settings/ShortcutFields'
import { ONBOARDING_STEPS } from './steps'

export interface OnboardingPaneProps {
  /** 0-based, from `studio.onboardingStep`; clamped to the known steps. */
  step: number
  summonHotkey: Settings['summonHotkey']
  captureHotkey: Settings['captureHotkey']
  hasApiKey: boolean
  keyStorage: 'os-encrypted' | 'memory'
  hotkeyErrors?: { summonHotkey?: string; captureHotkey?: string }
  onStep: (step: number) => void
  onFinish: () => void
  onUpdate: (patch: SettingsPatch) => void
  onSaveKey: (key: string) => Promise<ApiKeyResult>
  onOpenLink: (url: string) => void
  onRecordingChange?: (recording: boolean) => void
  /** The `lens` slice, when main serves it: shows whether the browser extension is connected. */
  lens?: Pick<StateSlices['lens'], 'bridge' | 'clients'>
}

// Forward enters from the right and leaves to the left; Back is the mirror.
// Under reduced motion, MotionConfig drops the x and keeps the cross-fade.
const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: 24 * dir }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: -24 * dir })
}

/** First run: Welcome → Gemini key → shortcuts → done. Fills the Studio window. */
export function OnboardingPane(props: OnboardingPaneProps): React.JSX.Element {
  const last = ONBOARDING_STEPS.length - 1
  const step = Math.min(Math.max(0, Math.trunc(props.step)), last)
  const [shown, setShown] = useState(step)
  const [dir, setDir] = useState(1)
  if (shown !== step) {
    setDir(step > shown ? 1 : -1)
    setShown(step)
  }

  const stage = useRef<HTMLDivElement>(null)
  // Each new step takes focus (its heading, unless a field inside already has it),
  // so screen readers announce it and Tab starts from the top of the step.
  useEffect(() => {
    const el = stage.current?.querySelector<HTMLElement>(`[data-step="${step}"]`)
    if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('h1')?.focus()
  }, [step])

  return (
    <main className="hoot-onb hoot-material hoot-material--pane">
      <div className="hoot-onb__bar hoot-studio-drag">
        <ol className="hoot-onb__progress" aria-label="Setup progress">
          {ONBOARDING_STEPS.map((name, i) => (
            <li
              key={name}
              aria-current={i === step ? 'step' : undefined}
              data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}
            >
              <span className="hoot-visually-hidden">
                {name}
                {i < step ? ', done' : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div ref={stage} className="hoot-onb__stage">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div
            key={step}
            data-step={step}
            className="hoot-onb__step"
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={springs.standard}
          >
            <StepBody {...props} step={step} />
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}

function StepBody(p: OnboardingPaneProps): React.JSX.Element {
  const next = (): void => p.onStep(p.step + 1)
  const back = (): void => p.onStep(p.step - 1)

  switch (p.step) {
    case 0:
      return (
        <Step
          intro
          art={<Owl mood="idle" size={72} label="Hoot" />}
          title="Hi, I’m Hoot"
          lead="A small owl that helps with whatever is on your screen."
          footer={
            <Button variant="primary" onClick={next}>
              Get started
            </Button>
          }
        >
          <ul className="hoot-onb__features">
            <Feature icon={<Keyboard />} keys={p.summonHotkey}>
              Summon me from any app
            </Feature>
            <Feature icon={<Lasso />} keys={p.captureHotkey}>
              Circle anything on screen and ask about it
            </Feature>
            <Feature icon={<Pin />}>Pin answers as sticky notes</Feature>
            <Feature icon={<BookOpenText />}>
              Explain hard words in place, in your browser and PDFs
            </Feature>
          </ul>
        </Step>
      )
    case 1:
      return (
        <Step
          title="Connect Gemini"
          lead="Hoot answers with Google Gemini, using your own API key. A free key takes about a minute to get."
          onBack={back}
          footer={
            p.hasApiKey ? (
              <Button variant="primary" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button onClick={next}>Skip for now</Button>
            )
          }
        >
          <ApiKeyField
            hasKey={p.hasApiKey}
            keyStorage={p.keyStorage}
            onSave={p.onSaveKey}
            onOpenLink={p.onOpenLink}
            autoFocus={!p.hasApiKey}
          />
          <p className="hoot-onb__note">
            Gemini API keys are for people 18 and over. With a free key, Google may use what you
            send, screenshots included, to improve its products, and people at Google may read it.
            With billing turned on, it doesn’t.{' '}
            <a
              href={GEMINI_TERMS_URL}
              onClick={(e) => {
                e.preventDefault()
                p.onOpenLink(GEMINI_TERMS_URL)
              }}
            >
              Gemini API terms
            </a>
          </p>
        </Step>
      )
    case 2:
      return (
        <Step
          title="Your shortcuts"
          lead="They work from any app. Change them now, or later in Settings."
          onBack={back}
          footer={
            <Button variant="primary" onClick={next}>
              Continue
            </Button>
          }
        >
          <div className="hoot-onb__shortcuts">
            <ShortcutFields
              summonHotkey={p.summonHotkey}
              captureHotkey={p.captureHotkey}
              errors={p.hotkeyErrors}
              onUpdate={p.onUpdate}
              onRecordingChange={p.onRecordingChange}
            />
          </div>
        </Step>
      )
    default:
      return (
        <Step
          intro
          art={<Owl mood="celebrate" size={72} label="Hoot" />}
          title="You’re all set"
          lead={
            <>
              Press <Kbd keys={acceleratorKeys(p.summonHotkey)} /> to summon Hoot, or{' '}
              <Kbd keys={acceleratorKeys(p.captureHotkey)} /> to circle something on screen.
            </>
          }
          onBack={back}
          footer={
            <Button variant="primary" onClick={p.onFinish}>
              Start using Hoot
            </Button>
          }
        >
          {p.lens && (
            <ExtensionStatus
              className="hoot-onb__wide"
              bridge={p.lens.bridge}
              clients={p.lens.clients}
            />
          )}
          {!p.hasApiKey && (
            <p className="hoot-onb__note hoot-onb__wide">
              Hoot can’t answer until you add a Gemini key. You can add one any time in Settings.
            </p>
          )}
        </Step>
      )
  }
}

function Step({
  intro = false,
  art,
  title,
  lead,
  onBack,
  footer,
  children
}: {
  intro?: boolean
  art?: ReactNode
  title: string
  lead: ReactNode
  onBack?: () => void
  footer: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section className="hoot-onb__body" data-intro={intro || undefined} aria-labelledby={id}>
      {art}
      <h1 id={id} className="hoot-t-title hoot-onb__title" tabIndex={-1}>
        {title}
      </h1>
      <p className="hoot-t-body-lg hoot-t-secondary hoot-onb__lead">{lead}</p>
      {children}
      <div className="hoot-onb__footer">
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {footer}
      </div>
    </section>
  )
}

function Feature({
  icon,
  keys,
  children
}: {
  icon: ReactNode
  keys?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <li className="hoot-onb__feature">
      <span className="hoot-onb__feature-icon" aria-hidden>
        {icon}
      </span>
      <span className="hoot-onb__feature-text">{children}</span>
      {keys && <Kbd keys={acceleratorKeys(keys)} />}
    </li>
  )
}
