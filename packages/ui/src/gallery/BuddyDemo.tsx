import type { BuddyMode, HootApi, Point, Rect } from '@hoot/core'
import { motion, type Transition } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Buddy } from '../buddy/Buddy'
import { Button } from '../components/Button'
import { Segmented } from '../components/Segmented'
import { Switch } from '../components/Switch'
import { springs } from '../motion/springs'
import { useHootState } from '../state/useHootState'
import { createFakeBuddyMain } from './fakeBuddyMain'

const SLICES = ['buddy', 'chat'] as const
const DESKTOP = { x: 0, y: 0, width: 960, height: 700 }
const INSET = 40
const CORNERS = {
  'top-left': { x: INSET, y: INSET },
  'top-right': { x: DESKTOP.width - INSET, y: INSET },
  'bottom-left': { x: INSET, y: DESKTOP.height - INSET },
  'bottom-right': { x: DESKTOP.width - INSET, y: DESKTOP.height - INSET }
} satisfies Record<string, Point>
type Corner = keyof typeof CORNERS

const INSTANT: Transition = { duration: 0 }

/**
 * The Buddy on a fake desktop, driven by a fake main (mode machine,
 * transitions and acks, drag with flick and snap, streaming chat). The
 * dashed box is the transparent window; hit regions can be overlaid.
 */
export function BuddyDemo(): React.JSX.Element {
  const [main] = useState(() =>
    createFakeBuddyMain({ workArea: DESKTOP, anchor: CORNERS['bottom-right'], mode: 'dot' })
  )
  useEffect(() => () => main.dispose(), [main])
  const { state } = useHootState(main.hoot as unknown as HootApi, SLICES)
  const [corner, setCorner] = useState<Corner>('bottom-right')
  const [showHits, setShowHits] = useState(false)
  const [hits, setHits] = useState<Rect[]>([])
  useEffect(() => main.onHitRegions(setHits), [main])

  // The window jumps with mode changes and drags; it glides only after a release.
  const glide = useRef<Transition>(INSTANT)
  const [move, setMove] = useState<Transition>(INSTANT)
  useEffect(
    () =>
      main.onSettle((flick) => {
        glide.current = flick ? springs.momentum : springs.standard
      }),
    [main]
  )
  const bounds = state?.buddy?.layout?.bounds
  useEffect(() => {
    setMove(glide.current)
    glide.current = INSTANT
  }, [bounds?.x, bounds?.y])

  const desktop = useRef<HTMLDivElement>(null)
  const onPointerMove = (e: React.PointerEvent): void => {
    const r = desktop.current?.getBoundingClientRect()
    if (r) main.pointer({ x: e.clientX - r.left, y: e.clientY - r.top })
  }

  const buddy = state?.buddy
  const chat = state?.chat
  return (
    <div className="gallery__buddy">
      <div className="gallery__buddy-controls">
        <Segmented<BuddyMode>
          label="Mode"
          size="sm"
          value={buddy?.mode ?? 'dot'}
          onChange={main.requestMode}
          options={[
            { value: 'hidden', label: 'Hidden' },
            { value: 'dot', label: 'Dot' },
            { value: 'pill', label: 'Pill' },
            { value: 'card', label: 'Card' }
          ]}
        />
        <Segmented<Corner>
          label="Corner"
          size="sm"
          value={corner}
          onChange={(c) => {
            setCorner(c)
            main.moveAnchor(CORNERS[c])
          }}
          options={[
            { value: 'top-left', label: 'Top left' },
            { value: 'top-right', label: 'Top right' },
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'bottom-right', label: 'Bottom right' }
          ]}
        />
        <div className="gallery__row">
          <Button
            size="sm"
            onClick={() =>
              main.greet({
                title: 'Good evening',
                subtitle: 'You copied some text. Want me to explain it?',
                action: 'clipboard'
              })
            }
          >
            Greet
          </Button>
          <Button size="sm" onClick={() => main.copy({ kind: 'text', chars: 1240 })}>
            Copy some text
          </Button>
          <Button
            size="sm"
            onClick={() => {
              main.requestMode('dot')
              void main.hoot.chat.send({ text: 'Summarize the lease PDF' })
            }}
          >
            Answer in the background
          </Button>
        </div>
        <Switch label="Show hit regions" checked={showHits} onChange={setShowHits} />
      </div>

      <div
        ref={desktop}
        className="gallery__desktop"
        style={{ width: DESKTOP.width, height: DESKTOP.height }}
        onPointerMove={onPointerMove}
      >
        {buddy && chat && bounds && (
          <motion.div
            className="gallery__buddy-window"
            data-mode={buddy.mode}
            initial={false}
            animate={{ x: bounds.x, y: bounds.y }}
            transition={move}
            style={{ width: bounds.width, height: bounds.height }}
          >
            <Buddy host={main.hoot} buddy={buddy} chat={chat} captureHotkey="Control+Alt+Space" />
            {showHits &&
              hits.map((r, i) => (
                <span
                  key={i}
                  className="gallery__hit"
                  aria-hidden
                  style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
                />
              ))}
          </motion.div>
        )}
      </div>
    </div>
  )
}
