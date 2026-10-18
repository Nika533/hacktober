import type { BrowserWindow } from 'electron'
import type { Rect, Unsubscribe, WindowKind } from '@hoot/core'
import { centreInWorkArea, intersectsAny } from './bounds'
import type { WindowRegistry } from './base'

/** The part of Electron's `screen` the display watcher needs. */
export interface DisplayScreen {
  on(event: 'display-added' | 'display-removed' | 'display-metrics-changed', cb: () => void): void
  removeListener(
    event: 'display-added' | 'display-removed' | 'display-metrics-changed',
    cb: () => void
  ): void
  getAllDisplays(): { workArea: Rect }[]
  getPrimaryDisplay(): { workArea: Rect }
}

const EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'] as const
/** Windows may emit several events for one topology change. */
const DEBOUNCE_MS = 250
/** Windows that re-centre when stranded off every work area. */
const RECENTRE_KINDS: WindowKind[] = ['studio', 'reader']

const recentre = (win: BrowserWindow, primary: Rect): void => {
  if (win.isDestroyed() || !win.isVisible()) return
  const b = win.getBounds()
  win.setBounds(centreInWorkArea(primary, { width: b.width, height: b.height }))
}

/**
 * Display topology changes: the buddy re-resolves its anchor and relayouts
 * (also on a scale-factor change), and a visible Studio/Reader stranded
 * outside every work area re-centres on the primary. Returns an unsubscribe.
 */
export function watchDisplays(deps: {
  screen: DisplayScreen
  windows: WindowRegistry
  relayoutBuddy: () => void
  debounceMs?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}): Unsubscribe {
  const delay = deps.debounceMs ?? DEBOUNCE_MS
  const setT = deps.setTimeoutImpl ?? setTimeout
  const clearT = deps.clearTimeoutImpl ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null

  const check = (): void => {
    timer = null
    deps.relayoutBuddy()
    const workAreas = deps.screen.getAllDisplays().map((d) => d.workArea)
    const primary = deps.screen.getPrimaryDisplay().workArea
    for (const kind of RECENTRE_KINDS) {
      const w = deps.windows.get(kind)
      if (!w || w.isDestroyed() || !w.isVisible()) continue
      if (!intersectsAny(w.getBounds(), workAreas)) recentre(w, primary)
    }
  }

  const schedule = (): void => {
    if (timer) clearT(timer)
    timer = setT(check, delay)
  }

  for (const ev of EVENTS) deps.screen.on(ev, schedule)
  return () => {
    for (const ev of EVENTS) deps.screen.removeListener(ev, schedule)
    if (timer) {
      clearT(timer)
      timer = null
    }
  }
}
