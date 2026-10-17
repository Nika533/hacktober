import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'path'

export interface TrayDeps {
  onSummon(): void
  onTrayClick(): void
  onCapture(): void
  onOpenStudio(): void
  onOpenSettings(): void
  onTogglePins(): void
}

export interface TrayHandle {
  tray: Tray
  /** Rebuild the menu when the pinned-notes label changes. */
  refresh(pinCount: number, notesHidden: boolean): void
}

function buildMenu(deps: TrayDeps, pinCount: number, notesHidden: boolean): Menu {
  return Menu.buildFromTemplate([
    { label: 'Show Hoot (Ctrl+Shift+Space)', click: deps.onSummon },
    { label: 'Circle something (Ctrl+Alt+Space)', click: deps.onCapture },
    {
      label: notesHidden ? `Show pinned notes (${pinCount})` : 'Hide pinned notes',
      enabled: pinCount > 0 || notesHidden,
      click: deps.onTogglePins
    },
    { type: 'separator' },
    { label: 'Open Studio', click: deps.onOpenStudio },
    { label: 'Settings…', click: deps.onOpenSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}

export function createTray(deps: TrayDeps): TrayHandle {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../resources/tray.png'))
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Hoot')

  let last = ''
  const refresh = (pinCount: number, notesHidden: boolean): void => {
    const key = `${pinCount}:${notesHidden}`
    if (key === last) return
    last = key
    tray.setContextMenu(buildMenu(deps, pinCount, notesHidden))
  }
  refresh(0, false)
  tray.on('click', deps.onTrayClick)
  return { tray, refresh }
}
