import { VOICE_PROBLEM_TEXT, type VoicePhase, type VoiceSlice } from '@hoot/core'
import { Mic, Volume2, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Button } from '../components/Button'
import { IconButton } from '../components/IconButton'
import { cx } from '../cx'

/** What the voice controls call: `window.hoot.voice`, or a fake in the gallery. */
export interface VoiceControls {
  start(): void
  finish(): void
  stop(): void
}

const BUTTON_LABEL: Record<VoicePhase, string> = {
  off: 'Talk to Hoot',
  starting: 'Starting voice… (press to cancel)',
  listening: 'Done talking',
  thinking: 'Talk now (Hoot stops answering aloud)',
  speaking: 'Talk now (Hoot stops speaking)'
}

/**
 * The mic: starts a voice chat, says "done talking" while Hoot listens, and
 * cuts Hoot off to listen again while it thinks or speaks. Its ring follows
 * the microphone level while listening.
 */
export function VoiceButton({
  voice,
  controls,
  size = 'sm',
  className
}: {
  voice: VoiceSlice
  controls: VoiceControls
  size?: 'sm' | 'md'
  className?: string
}): React.JSX.Element {
  const { phase } = voice
  const onClick = (): void => {
    if (phase === 'listening') controls.finish()
    else if (phase === 'starting') controls.stop()
    else controls.start()
  }
  const style = { '--hoot-voice-level': phase === 'listening' ? voice.level : 0 } as CSSProperties
  return (
    <IconButton
      label={BUTTON_LABEL[phase]}
      size={size}
      variant={phase === 'listening' ? 'accent' : 'ghost'}
      className={cx('hoot-voice-btn', className)}
      data-phase={phase}
      aria-pressed={phase !== 'off'}
      style={style}
      onClick={onClick}
    >
      {phase === 'speaking' ? <Volume2 /> : <Mic />}
    </IconButton>
  )
}

function statusText(voice: VoiceSlice): string {
  switch (voice.phase) {
    case 'starting':
      return 'Starting voice…'
    case 'listening':
      return voice.heard ? `“${voice.heard}”` : 'Listening… say what you need.'
    case 'thinking':
      return 'Thinking…'
    case 'speaking':
      return 'Hoot is speaking. Press the mic to cut in.'
    default:
      return ''
  }
}

/**
 * The line above the composer during a voice chat: what Hoot heard, what
 * it's doing, and End. After a failed start it explains why instead.
 */
export function VoiceStatus({
  voice,
  controls,
  className
}: {
  voice: VoiceSlice
  controls: VoiceControls
  className?: string
}): React.JSX.Element | null {
  if (voice.phase === 'off') {
    if (!voice.problem) return null
    return (
      <div className={cx('hoot-voice', 'hoot-voice--problem', className)} role="alert">
        <p className="hoot-voice__text">{VOICE_PROBLEM_TEXT[voice.problem]}</p>
        <IconButton size="sm" label="Dismiss" onClick={controls.stop}>
          <X />
        </IconButton>
      </div>
    )
  }
  const style = { '--hoot-voice-level': voice.level } as CSSProperties
  return (
    <div className={cx('hoot-voice', className)} data-phase={voice.phase} style={style}>
      <span className="hoot-voice__meter hoot-chrome" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <p
        className={cx('hoot-voice__text', voice.heard && 'hoot-voice__text--heard')}
        role="status"
        aria-live="polite"
      >
        {statusText(voice)}
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="hoot-chrome"
        aria-label="End voice chat"
        onClick={controls.stop}
      >
        End
      </Button>
    </div>
  )
}
