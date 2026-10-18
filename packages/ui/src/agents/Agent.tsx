import {
  AGENT_COLOR_NAMES,
  AGENT_OWL_AT,
  agentMood,
  stripAnnotationTags,
  type AgentState,
  type HootApi
} from '@hoot/core'
import { Minus, X } from 'lucide-react'
import { motion, useReducedMotion, type TargetAndTransition } from 'motion/react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useOwlDrag } from '../buddy/useOwlDrag'
import { codeChangesFor } from '../chat/codeChangesFor'
import { Composer } from '../chat/Composer'
import { Transcript } from '../chat/Transcript'
import { toMessageViews } from '../chat/views'
import { IconButton } from '../components/IconButton'
import { Owl } from '../components/Owl'
import { crossFade, springs } from '../motion/springs'

/** The part of `window.hoot` an agent's window uses. */
export type AgentHost = Pick<HootApi, 'agents' | 'clipboard' | 'app' | 'code' | 'pins' | 'windows'>

export interface AgentProps {
  host: AgentHost
  agent: AgentState
}

const fire = (p: Promise<unknown>): void => void p.catch(() => undefined)

/** In and out of the owl along one path: scale from its centre, blur as it goes. */
const IN_OWL: TargetAndTransition = { opacity: 0, scale: 0.15, filter: 'blur(6px)' }
const OUT_OF_OWL: TargetAndTransition = { opacity: 1, scale: 1, filter: 'blur(0px)' }

/**
 * An agent's window: its own chat in a card, or (minimized) just its owl in
 * the agent's colour, free to drag anywhere. The card shrinks into the owl
 * and grows back out of it; main resizes the window around the owl.
 */
export function Agent({ host, agent }: AgentProps): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  const titleId = useId()
  // The card is animating into its owl; main shrinks the window once it's there.
  const [leaving, setLeaving] = useState(false)
  const [shownMinimized, setShownMinimized] = useState(agent.minimized)
  if (shownMinimized !== agent.minimized) {
    setShownMinimized(agent.minimized)
    setLeaving(false)
  }
  const dragHost = useMemo(
    () => ({
      dragStart: () => host.agents.dragStart(),
      dragMove: () => host.agents.dragMove(),
      dragEnd: (v: { vx: number; vy: number }) => host.agents.dragEnd(v),
      setIgnoreMouse: () => undefined
    }),
    [host]
  )
  const drag = useOwlDrag(dragHost)
  const mood = agentMood(agent)
  const messages = useMemo(() => toMessageViews(agent.session), [agent.session])
  const streaming = agent.stream !== null
  const name = agent.name

  // Esc stops an answer first, then tucks the agent into its owl.
  useEffect(() => {
    if (agent.minimized) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (streaming) fire(host.agents.stop())
      else setLeaving(true)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [host, streaming, agent.minimized])

  if (agent.minimized) {
    return (
      <div className="hoot-agent" data-mode="owl" data-color={agent.color}>
        <motion.button
          type="button"
          className="hoot-agent-owl hoot-chrome"
          style={{ left: AGENT_OWL_AT.x - 28, top: AGENT_OWL_AT.y - 28 }}
          aria-label={agent.answerReady ? `Open ${name}, an answer is ready` : `Open ${name}`}
          title={name}
          initial={reduced ? { opacity: 0 } : { opacity: 1, scale: 32 / 56 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? crossFade : springs.standard}
          onClick={() => {
            if (!drag.consumeDrag()) fire(host.agents.restore())
          }}
          {...drag.handlers}
        >
          <Owl mood={mood} tint={agent.color} />
          {agent.answerReady && <span className="hoot-agent-owl__badge" aria-hidden />}
        </motion.button>
      </div>
    )
  }

  return (
    <div className="hoot-agent" data-mode="card" data-color={agent.color}>
      <motion.section
        className="hoot-agent-card hoot-material hoot-material--card"
        aria-labelledby={titleId}
        style={{ transformOrigin: `${AGENT_OWL_AT.x - 8}px ${AGENT_OWL_AT.y - 8}px` }}
        initial={reduced ? { opacity: 0 } : IN_OWL}
        animate={
          leaving ? (reduced ? { opacity: 0 } : IN_OWL) : reduced ? { opacity: 1 } : OUT_OF_OWL
        }
        transition={reduced ? crossFade : leaving ? springs.sheet : springs.standard}
        onAnimationComplete={() => {
          if (leaving) fire(host.agents.minimize())
        }}
      >
        <header className="hoot-agent-card__header hoot-chrome">
          <span className="hoot-agent-card__owl">
            <Owl mood={mood} tint={agent.color} size={32} />
          </span>
          <div className="hoot-agent-card__heading">
            <h1 id={titleId} className="hoot-agent-card__title">
              {agent.session?.title || name}
            </h1>
            {agent.session && <p className="hoot-agent-card__name">{name}</p>}
          </div>
          <div className="hoot-agent-card__actions">
            <IconButton label="Minimize to its owl" shortcut="Esc" onClick={() => setLeaving(true)}>
              <Minus />
            </IconButton>
            <IconButton label={`Close ${name}`} onClick={() => fire(host.agents.close())}>
              <X />
            </IconButton>
          </div>
        </header>

        <Transcript
          messages={messages}
          label={`${name}’s conversation`}
          className="hoot-agent-card__transcript"
          onRegenerate={() => fire(host.agents.regenerate())}
          onPin={(id) => {
            const m = agent.session?.messages.find((x) => x.id === id)
            if (m) fire(host.pins.createFromText(stripAnnotationTags(m.text)))
          }}
          onCopy={(text) => host.clipboard.writeText(text)}
          onOpenLink={(href) => fire(host.app.openExternal(href))}
          onAddKey={() => fire(host.windows.openStudio('settings'))}
          onOpenSettings={() => fire(host.windows.openStudio('settings'))}
          answerFooter={codeChangesFor(host.code, agent.session)}
          empty={
            <div className="hoot-agent-card__empty">
              <p className="hoot-agent-card__empty-title">{name} is ready</p>
              <p className="hoot-agent-card__empty-hint">
                It keeps its own chat and answers while you carry on with Hoot. Minimize it and it
                waits as a {AGENT_COLOR_NAMES[agent.color].toLowerCase()} owl.
              </p>
            </div>
          }
        />

        <div className="hoot-agent-card__bottom">
          <Composer
            autoFocus
            streaming={streaming}
            label={`Message ${name}`}
            placeholder={`Ask ${name}`}
            hint={false}
            onSend={(text) => fire(host.agents.send({ text }))}
            onStop={() => fire(host.agents.stop())}
          />
        </div>
      </motion.section>
    </div>
  )
}
