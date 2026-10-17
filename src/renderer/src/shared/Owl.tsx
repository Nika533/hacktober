import { animate, motion, useMotionValue } from 'motion/react'
import { useEffect, useId, useRef } from 'react'
import type { OwlMood } from '../../../shared/types'
import { useCursor, usePrefersDark, useReducedMotion } from './hooks'
import { springPupil } from './springs'

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

interface Props {
  mood: OwlMood
  size?: number
}

export function Owl({ mood, size = 56 }: Props): React.JSX.Element {
  const reduced = useReducedMotion()
  const dark = usePrefersDark()
  const cursor = useCursor()
  // unique gradient ids — several Owl instances can share a document
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const discId = `owld-${uid}`
  const bodyId = `owlb-${uid}`

  const pupilX = useMotionValue(0)
  const pupilY = useMotionValue(0)
  const eyeOpen = useMotionValue(1)
  const tilt = useMotionValue(0)
  const bobY = useMotionValue(0)
  const shakeX = useMotionValue(0)
  const beakOpen = useMotionValue(0)
  const tuftUp = useMotionValue(0)
  const ringR = useMotionValue(28)
  const ringO = useMotionValue(0)

  // --- pupils follow the cursor (dot/pill only; main stops sending otherwise)
  useEffect(() => {
    if (reduced) return
    if (mood === 'thinking') {
      void animate(pupilX, -2, springPupil)
      void animate(pupilY, -2, springPupil)
      return
    }
    void animate(pupilX, clamp(cursor.x * 0.05, -3, 3), springPupil)
    void animate(pupilY, clamp(cursor.y * 0.05, -3, 3), springPupil)
  }, [cursor, mood, reduced, pupilX, pupilY])

  // --- idle: random blinks (3–7 s) + occasional head tilt (8–15 s)
  useEffect(() => {
    if (reduced) return
    let alive = true
    let t1: ReturnType<typeof setTimeout>, t2: ReturnType<typeof setTimeout>
    const blink = (): void => {
      const slow = mood === 'thinking'
      void animate(eyeOpen, [1, 0.12, 1], { duration: slow ? 0.6 : 0.22 }).then(() => {
        if (alive) t1 = setTimeout(blink, 3000 + Math.random() * 4000)
      })
    }
    const tiltIdle = (): void => {
      if (mood === 'idle' || mood === 'listening') {
        const dir = Math.random() > 0.5 ? 1 : -1
        void animate(tilt, [0, 5 * dir, -3 * dir, 0], { duration: 1.6 })
      }
      if (alive) t2 = setTimeout(tiltIdle, 8000 + Math.random() * 7000)
    }
    t1 = setTimeout(blink, 1500 + Math.random() * 3000)
    t2 = setTimeout(tiltIdle, 6000 + Math.random() * 6000)
    return () => {
      alive = false
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [reduced, mood, eyeOpen, tilt])

  // --- talking: beak opens per delta burst, throttled to 120 ms
  const lastTalk = useRef(0)
  useEffect(() => {
    if (mood !== 'talking' || reduced) return
    return window.hoot.onDelta(() => {
      const now = Date.now()
      if (now - lastTalk.current < 120) return
      lastTalk.current = now
      void animate(beakOpen, [1, 0.3, 1, 0.3], { duration: 0.5 })
    })
  }, [mood, reduced, beakOpen])

  // --- mood-specific poses
  useEffect(() => {
    switch (mood) {
      case 'listening':
        void animate(tuftUp, 1, { duration: 0.25 })
        void animate(tilt, 0, { duration: 0.25 })
        break
      case 'thinking':
        if (!reduced) void animate(tilt, 8, { duration: 0.4 })
        break
      case 'celebrate':
        if (reduced) break
        void animate(bobY, [0, -7, 0], { type: 'spring', bounce: 0.3, duration: 0.7 })
        ringR.set(28)
        ringO.set(0.55)
        void animate(ringR, 40, { duration: 1.0 })
        void animate(ringO, 0, { duration: 1.0 })
        break
      case 'error':
        if (!reduced) void animate(shakeX, [0, -4, 4, -2, 2, 0], { duration: 0.45 })
        void animate(eyeOpen, 0.45, { duration: 0.2 })
        break
      default:
        void animate(tilt, 0, { duration: 0.35 })
        void animate(tuftUp, 0, { duration: 0.35 })
        void animate(bobY, 0, { duration: 0.3 })
    }
    if (mood !== 'error') void animate(eyeOpen, 1, { duration: 0.3 })
    if (mood !== 'talking') void animate(beakOpen, 0, { duration: 0.2 })
    return undefined
  }, [mood, reduced, tilt, tuftUp, bobY, shakeX, eyeOpen, beakOpen, ringR, ringO])

  const wide = mood === 'listening' ? 1.1 : 1

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      style={{ x: shakeX, y: bobY, overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        <linearGradient id={discId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={dark ? '#3A3026' : '#FFF7EA'} />
          <stop offset="1" stopColor={dark ? '#2A231C' : '#F5E6CC'} />
        </linearGradient>
        <linearGradient id={bodyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8B5E3C" />
          <stop offset="1" stopColor="#6F4A2F" />
        </linearGradient>
      </defs>

      <motion.circle
        cx={28}
        cy={28}
        r={ringR}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        style={{ opacity: ringO }}
      />
      <circle cx={28} cy={28} r={27.5} fill={`url(#${discId})`} />

      <motion.g
        style={{
          rotate: tilt,
          transformBox: 'fill-box',
          transformOrigin: '50% 60%'
        }}
      >
        {/* ear tufts */}
        <motion.g style={{ y: tuftUp }}>
          <path d="M17 12 L21.5 18.5 L14.5 17.5 Z" fill="#6F4A2F" />
          <path d="M39 12 L34.5 18.5 L41.5 17.5 Z" fill="#6F4A2F" />
        </motion.g>

        {/* body */}
        <ellipse cx={28} cy={35} rx={13.5} ry={13} fill={`url(#${bodyId})`} />
        {/* belly chevrons */}
        <g stroke="#5C3D27" strokeWidth={1.1} strokeLinecap="round" fill="none" opacity={0.75}>
          <path d="M22 40 l3 2.4 l3 -2.4" />
          <path d="M28 40 l3 2.4 l3 -2.4" transform="translate(-3 0)" />
          <path d="M22.5 44 l3 2.4 l3 -2.4" />
          <path d="M28.5 44 l3 2.4 l3 -2.4" transform="translate(-3 0)" />
        </g>

        {/* face discs */}
        <circle cx={21.5} cy={22.5} r={7.6} fill="#F3E3C3" />
        <circle cx={34.5} cy={22.5} r={7.6} fill="#F3E3C3" />

        {/* eyes — scaleY doubles as blink + squint */}
        <motion.g
          style={{
            scaleY: eyeOpen,
            scaleX: wide,
            transformBox: 'fill-box',
            transformOrigin: '50% 42%'
          }}
        >
          <circle cx={21.5} cy={22.5} r={4.8} fill="#FFFFFF" />
          <circle cx={34.5} cy={22.5} r={4.8} fill="#FFFFFF" />
          <motion.g style={{ x: pupilX, y: pupilY }}>
            <circle cx={21.5} cy={22.5} r={2.3} fill="#1D1D1F" />
            <circle cx={34.5} cy={22.5} r={2.3} fill="#1D1D1F" />
            <circle cx={20.7} cy={21.7} r={0.85} fill="#FFFFFF" />
            <circle cx={33.7} cy={21.7} r={0.85} fill="#FFFFFF" />
          </motion.g>
        </motion.g>

        {/* beak */}
        <motion.g
          style={{
            scaleY: beakOpen,
            transformBox: 'fill-box',
            transformOrigin: '50% 0%'
          }}
        >
          <path d="M28 27.5 L25 30.5 L31 30.5 Z" fill="#D8922B" />
        </motion.g>
        <path d="M28 27.5 L25.5 29.5 L30.5 29.5 Z" fill="#F2A93B" />
      </motion.g>
    </motion.svg>
  )
}
