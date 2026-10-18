import { app, Menu, nativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Unsubscribe } from '@hoot/core'
import type { Logger } from './log'
import type { Store } from './store/store'

/** Everything the menu needs — pure for `buildTrayTemplate` tests. */
export interface TrayMenuState {
  summonHotkey: string
  captureHotkey: string
  pinCount: number
  notesHidden: boolean
}

export type TrayAction =
  'summon' | 'capture' | 'toggleNotes' | 'openStudio' | 'openReader' | 'openSettings' | 'quit'

export type TrayTemplateItem = MenuItemConstructorOptions & { id?: TrayAction }

/** "CommandOrControl+Shift+Space" → "Ctrl+Shift+Space" for the menu label. */
const prettyAccel = (a: string): string =>
  a.replace('CommandOrControl', 'Ctrl').replace('Command', 'Ctrl').replace('Control', 'Ctrl')

/** The context-menu template; actions are wired to `id`s by createTray. */
export function buildTrayTemplate(s: TrayMenuState): TrayTemplateItem[] {
  return [
    { id: 'summon', label: `Show Hoot (${prettyAccel(s.summonHotkey)})` },
    { id: 'capture', label: `Circle something (${prettyAccel(s.captureHotkey)})` },
    {
      id: 'toggleNotes',
      label: s.notesHidden ? `Show pinned notes (${s.pinCount})` : 'Hide pinned notes',
      enabled: s.pinCount > 0 || s.notesHidden
    },
    { type: 'separator' },
    { id: 'openStudio', label: 'Open Studio' },
    { id: 'openReader', label: 'Open in Hoot Reader…' },
    { id: 'openSettings', label: 'Settings…' },
    { type: 'separator' },
    { id: 'quit', label: 'Quit' }
  ]
}

export interface TrayDeps {
  store: Store
  log: Logger
  /** Left click: hidden → summon with greeting, visible → hide. */
  onTrayClick(): void
  /** "Show Hoot": the summon-aware toggle (Studio/onboarding handled). */
  onSummon(): void
  onCapture(): void
  /** The user toggled notes; `hidden` is the new state. */
  onToggleNotes(hidden: boolean): void
  onOpenStudio(): void
  /** "Open in Hoot Reader…": the file picker. */
  onOpenReader(): void
  onOpenSettings(): void
  onQuit(): void
}

export interface TrayHandle {
  destroy(): void
}

/** dev = <app>/resources; packaged = app.asar.unpacked (asarUnpack resources/**). */
const iconCandidates = (): string[] => [
  join(app.getAppPath(), 'resources', 'tray.png'),
  join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', 'tray.png')
]

export function createTray(deps: TrayDeps): TrayHandle {
  const iconPath = iconCandidates().find((p) => existsSync(p))
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  if (icon.isEmpty())
    deps.log.warn(`tray icon missing (tried ${iconCandidates().join(', ')}) — using an empty icon`)
  const tray = new Tray(icon)
  tray.setToolTip('Hoot')
  tray.on('click', deps.onTrayClick)

  let notesHidden = false
  let lastKey = ''
  const clicks: Record<TrayAction, () => void> = {
    summon: deps.onSummon,
    capture: deps.onCapture,
    toggleNotes: () => {
      notesHidden = !notesHidden
      deps.onToggleNotes(notesHidden)
      rebuild()
    },
    openStudio: deps.onOpenStudio,
    openReader: deps.onOpenReader,
    openSettings: deps.onOpenSettings,
    quit: deps.onQuit
  }

  const menuState = (): TrayMenuState => {
    const s = deps.store.get('settings').settings
    return {
      summonHotkey: s.summonHotkey,
      captureHotkey: s.captureHotkey,
      pinCount: deps.store.get('pins').pins.length,
      notesHidden
    }
  }

  const rebuild = (): void => {
    const s = menuState()
    const key = `${s.summonHotkey}|${s.captureHotkey}|${s.pinCount}|${s.notesHidden}`
    if (key === lastKey) return
    lastKey = key
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayTemplate(s).map((item) => {
          const { id, ...rest } = item
          return id ? { ...rest, click: clicks[id] } : rest
        })
      )
    )
  }

  const unwatch: Unsubscribe = deps.store.onChange((changed) => {
    if (changed.has('settings') || changed.has('pins')) rebuild()
  })
  rebuild()

  return {
    destroy() {
      unwatch()
      tray.destroy()
    }
  }
}
