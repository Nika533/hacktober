import { screen, type BrowserWindow } from 'electron'
import type { Point, Rect } from '@hoot/core'
import { createSecureWindow } from '../windows/base'
import { OWL, cardAt, fitInto, owlAt } from './geometry'

export interface AgentWindows {
  /** Open an agent's card at `bounds` (screen DIP). */
  open(agentId: string, bounds: Rect): void
  /** Card → owl or back; the owl stays where it is on screen. */
  setMinimized(agentId: string, minimized: boolean): void
  close(agentId: string): void
  closeAll(): void
  /** The agent whose window sent an IPC message. */
  agentFor(senderId: number): string | null
  dragStart(agentId: string): void
  dragMove(agentId: string): void
  dragEnd(agentId: string): void
}

export interface AgentWindowsDeps {
  rendererUrl(page: string): string
  /** The OS (Alt+F4) closed an agent's window, not Hoot. */
  onClosed(agentId: string): void
  onFileDrop?(path: string): void
}

/** One transparent, always-on-top window per agent: its card, or (minimized) just its owl. */
export function createAgentWindows(deps: AgentWindowsDeps): AgentWindows {
  const wins = new Map<string, BrowserWindow>()
  /** Closes Hoot started, which mustn't report back. */
  const closing = new Set<string>()
  const drags = new Map<string, Point>()

  const live = (id: string): BrowserWindow | null => {
    const win = wins.get(id)
    return win && !win.isDestroyed() ? win : null
  }
  const areaFor = (p: Point): Rect => screen.getDisplayNearestPoint(p).workArea
  const close = (agentId: string): void => {
    const win = live(agentId)
    if (!win) return
    closing.add(agentId)
    win.close()
  }

  return {
    open(agentId, bounds) {
      const win = createSecureWindow(
        'agent',
        {
          ...bounds,
          show: false,
          transparent: true,
          frame: false,
          resizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          hasShadow: false,
          alwaysOnTop: true,
          backgroundColor: '#00000000',
          // Agents keep answering (and their owls keep moving) while in the background.
          webPreferences: { backgroundThrottling: false }
        },
        deps.onFileDrop ? { onFileDrop: deps.onFileDrop } : undefined
      )
      win.setAlwaysOnTop(true, 'floating')
      wins.set(agentId, win)
      win.on('closed', () => {
        wins.delete(agentId)
        drags.delete(agentId)
        if (!closing.delete(agentId)) deps.onClosed(agentId)
      })
      win.once('ready-to-show', () => win.show())
      void win.loadURL(`${deps.rendererUrl('agent.html')}#${encodeURIComponent(agentId)}`)
    },

    setMinimized(agentId, minimized) {
      const win = live(agentId)
      if (!win) return
      const b = win.getBounds()
      const owl = { x: b.x + OWL.owl.x, y: b.y + OWL.owl.y }
      win.setBounds(minimized ? owlAt(owl, areaFor(owl)) : cardAt(owl, areaFor(owl)))
      if (!minimized) win.focus()
    },

    close,

    closeAll() {
      for (const id of [...wins.keys()]) close(id)
    },

    agentFor(senderId) {
      for (const [id, win] of wins) {
        if (!win.isDestroyed() && win.webContents.id === senderId) return id
      }
      return null
    },

    dragStart(agentId) {
      const win = live(agentId)
      if (!win) return
      const cursor = screen.getCursorScreenPoint()
      const [x = 0, y = 0] = win.getPosition()
      drags.set(agentId, { x: cursor.x - x, y: cursor.y - y })
    },

    dragMove(agentId) {
      const win = live(agentId)
      const offset = drags.get(agentId)
      if (!win || !offset) return
      const cursor = screen.getCursorScreenPoint()
      win.setPosition(Math.round(cursor.x - offset.x), Math.round(cursor.y - offset.y))
    },

    dragEnd(agentId) {
      const win = live(agentId)
      drags.delete(agentId)
      if (!win) return
      const b = win.getBounds()
      win.setBounds(fitInto(b, areaFor({ x: b.x + b.width / 2, y: b.y + b.height / 2 })))
    }
  }
}
