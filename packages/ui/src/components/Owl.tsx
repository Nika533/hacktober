import { animate, motion, useMotionValue, useReducedMotion, type MotionValue } from 'motion/react'
import { useEffect, useId, useRef } from 'react'
import { springs } from '../motion/springs'
import type { OwlMood } from './owlMood'

export interface OwlProps {
  mood: OwlMood
  /** Rendered size in px (the artwork is 56×56). */
  size?: number
  /** Pointer offset from the owl's centre in px; the pupils follow it. */
  gaze?: { x: number; y: number }
  /**
   * Bump on every streamed chunk while talking; the beak flaps per burst
   * (throttled). Leave undefined to flap on a steady beat instead.
   */
  talkSignal?: number
  /** Accessible name. Without it the owl is decorative (aria-hidden). */
  label?: string
  className?: string
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)
const TALK_THROTTLE_MS = 120

/** Held pose per mood: head tilt (deg), ear-tuft offset (px; negative perks them up), eye openness. */
const POSES: Record<OwlMood, { tilt: number; tuft: number; eye: number }> = {
  idle: { tilt: 0, tuft: 0, eye: 1 },
  listening: { tilt: 0, tuft: -1.5, eye: 1 },
  thinking: { tilt: 8, tuft: 0, eye: 1 },
  talking: { tilt: 0, tuft: 0, eye: 1 },
  celebrate: { tilt: 0, tuft: -1.5, eye: 1 },
  error: { tilt: 0, tuft: 0, eye: 0.45 }
}

export function Owl({
  mood,
  size = 56,
  gaze,
  talkSignal,
  label,
  className
}: OwlProps): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  // Several owls can share a document, so gradient ids must be unique.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const discId = `hoot-owl-disc-${uid}`
  const bodyId = `hoot-owl-body-${uid}`

  const pupilX = useMotionValue(0)
  const pupilY = useMotionValue(0)
  const eyeOpen = useMotionValue(1)
  const tilt = useMotionValue(0)
  const bobY = useMotionValue(0)
  const shakeX = useMotionValue(0)
  const beakOpen = useMotionValue(0)
  const tuftY = useMotionValue(0)
  const ringR = useMotionValue(28)
  const ringO = useMotionValue(0)

  const gx = gaze?.x ?? 0
  const gy = gaze?.y ?? 0

  // Pupils follow the pointer; thinking looks up and away. Under reduced
  // motion the eyes hold still (but still look away while thinking).
  useEffect(() => {
    const away = mood === 'thinking'
    if (reduced) {
      pupilX.set(away ? -2 : 0)
      pupilY.set(away ? -2 : 0)
      return
    }
    void animate(pupilX, away ? -2 : clamp(gx * 0.05, -3, 3), springs.pupil)
    void animate(pupilY, away ? -2 : clamp(gy * 0.05, -3, 3), springs.pupil)
  }, [gx, gy, mood, reduced, pupilX, pupilY])

  // Idle life: blinks every 3–7 s, an occasional head tilt every 8–15 s.
  useEffect(() => {
    if (reduced) return
    let alive = true
    let blinkTimer: ReturnType<typeof setTimeout> | undefined
    let tiltTimer: ReturnType<typeof setTimeout> | undefined
    const blink = (): void => {
      void animate(eyeOpen, [1, 0.12, 1], { duration: mood === 'thinking' ? 0.6 : 0.22 }).then(
        () => {
          if (alive) blinkTimer = setTimeout(blink, 3000 + Math.random() * 4000)
        }
      )
    }
    const tiltIdle = (): void => {
      if (mood === 'idle' || mood === 'listening') {
        const dir = Math.random() > 0.5 ? 1 : -1
        void animate(tilt, [0, 5 * dir, -3 * dir, 0], { duration: 1.6 })
      }
      if (alive) tiltTimer = setTimeout(tiltIdle, 8000 + Math.random() * 7000)
    }
    blinkTimer = setTimeout(blink, 1500 + Math.random() * 3000)
    tiltTimer = setTimeout(tiltIdle, 6000 + Math.random() * 6000)
    return () => {
      alive = false
      clearTimeout(blinkTimer)
      clearTimeout(tiltTimer)
    }
  }, [reduced, mood, eyeOpen, tilt])

  // Talking: flap per streamed burst, or on a steady beat without a signal.
  const lastFlap = useRef(0)
  useEffect(() => {
    if (mood !== 'talking') return
    if (reduced) {
      beakOpen.set(0.6)
      return
    }
    const flap = (): void => {
      const now = Date.now()
      if (now - lastFlap.current < TALK_THROTTLE_MS) return
      lastFlap.current = now
      void animate(beakOpen, [1, 0.3, 1, 0.3], { duration: 0.5 })
    }
    if (talkSignal !== undefined) {
      flap()
      return
    }
    flap()
    const beat = setInterval(flap, 650)
    return () => clearInterval(beat)
  }, [mood, reduced, talkSignal, beakOpen])

  // Mood poses. Each mood has a held pose, so moods stay readable under
  // reduced motion (applied instantly); the flourishes only play with motion.
  useEffect(() => {
    const to = (mv: MotionValue<number>, value: number, duration: number): void => {
      if (reduced) mv.set(value)
      else void animate(mv, value, { duration })
    }
    const pose = POSES[mood]
    to(tilt, pose.tilt, 0.35)
    to(tuftY, pose.tuft, 0.25)
    to(eyeOpen, pose.eye, mood === 'error' ? 0.2 : 0.3)
    to(bobY, 0, 0.3)
    if (mood !== 'talking') to(beakOpen, 0, 0.2)

    if (mood === 'celebrate') {
      if (reduced) {
        ringR.set(33)
        ringO.set(0.5)
      } else {
        // Hop up, then fall back with a little bounce (springs take two keyframes).
        void animate(bobY, -7, { duration: 0.18, ease: 'easeOut' }).then(() =>
          animate(bobY, 0, springs.momentum)
        )
        ringR.set(28)
        ringO.set(0.55)
        void animate(ringR, 40, { duration: 1 })
        void animate(ringO, 0, { duration: 1 })
      }
    } else {
      to(ringO, 0, 0.2)
    }
    if (mood === 'error' && !reduced) {
      void animate(shakeX, [0, -4, 4, -2, 2, 0], { duration: 0.45 })
    }
  }, [mood, reduced, tilt, tuftY, bobY, shakeX, eyeOpen, beakOpen, ringR, ringO])

  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      className={className ? `hoot-owl ${className}` : 'hoot-owl'}
      data-mood={mood}
      style={{ x: shakeX, y: bobY }}
      {...a11y}
    >
      <defs>
        <linearGradient id={discId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="hoot-owl__disc-1" />
          <stop offset="1" className="hoot-owl__disc-2" />
        </linearGradient>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="hoot-owl__body-1" />
          <stop offset="1" className="hoot-owl__body-2" />
        </linearGradient>
      </defs>

      <motion.circle
        cx={28}
        cy={28}
        r={ringR}
        className="hoot-owl__ring"
        strokeWidth={2}
        style={{ opacity: ringO }}
      />
      <circle cx={28} cy={28} r={27.5} fill={`url(#${discId})`} />

      <motion.g style={{ rotate: tilt, transformBox: 'fill-box', transformOrigin: '50% 60%' }}>
        <motion.g className="hoot-owl__tufts" style={{ y: tuftY }}>
          <path d="M17 12 L21.5 18.5 L14.5 17.5 Z" />
          <path d="M39 12 L34.5 18.5 L41.5 17.5 Z" />
        </motion.g>

        <ellipse cx={28} cy={35} rx={13.5} ry={13} fill={`url(#${bodyId})`} />
        <g className="hoot-owl__chevrons" strokeWidth={1.1} strokeLinecap="round">
          <path d="M22 40 l3 2.4 l3 -2.4" />
          <path d="M25 40 l3 2.4 l3 -2.4" />
          <path d="M22.5 44 l3 2.4 l3 -2.4" />
          <path d="M25.5 44 l3 2.4 l3 -2.4" />
        </g>

        <circle cx={21.5} cy={22.5} r={7.6} className="hoot-owl__face" />
        <circle cx={34.5} cy={22.5} r={7.6} className="hoot-owl__face" />

        {/* scaleY doubles as blink and squint */}
        <motion.g
          style={{
            scaleY: eyeOpen,
            scaleX: mood === 'listening' ? 1.1 : 1,
            transformBox: 'fill-box',
            transformOrigin: '50% 42%'
          }}
        >
          <circle cx={21.5} cy={22.5} r={4.8} className="hoot-owl__eye" />
          <circle cx={34.5} cy={22.5} r={4.8} className="hoot-owl__eye" />
          <motion.g style={{ x: pupilX, y: pupilY }}>
            <circle cx={21.5} cy={22.5} r={2.3} className="hoot-owl__pupil" />
            <circle cx={34.5} cy={22.5} r={2.3} className="hoot-owl__pupil" />
            <circle cx={20.7} cy={21.7} r={0.85} className="hoot-owl__eye" />
            <circle cx={33.7} cy={21.7} r={0.85} className="hoot-owl__eye" />
          </motion.g>
        </motion.g>

        <motion.g style={{ scaleY: beakOpen, transformBox: 'fill-box', transformOrigin: '50% 0%' }}>
          <path d="M28 27.5 L25 30.5 L31 30.5 Z" className="hoot-owl__beak-open" />
        </motion.g>
        <path d="M28 27.5 L25.5 29.5 L30.5 29.5 Z" className="hoot-owl__beak" />
      </motion.g>
    </motion.svg>
  )
}
