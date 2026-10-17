import { BrowserWindow, type Display } from 'electron'
import path from 'path'
import { IPC } from '../../shared/ipc'

export interface OverlayDeps {
  isDev(): boolean
  rendererUrl(page: string): string
}

/**
 * Full-screen capture overlay. One hidden window is pre-created at startup
 * and re-positioned over the target display for each capture.
 */
export class OverlayWindow {
  win: BrowserWindow | null = null

  constructor(private deps: OverlayDeps) {}

  create(): void {
    this.win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      focusable: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    this.win.on('closed', () => {
      this.win = null
    })
    const url = this.deps.rendererUrl('overlay.html')
    if (this.deps.isDev()) void this.win.loadURL(url)
    else void this.win.loadFile(url)
  }

  showOn(display: Display): void {
    if (!this.win) return
    this.win.setBounds(display.bounds)
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.show()
    this.win.focus()
    // Windows per-monitor DPI quirk: bounds settle wrong on first show,
    // so apply them a second time.
    this.win.setBounds(display.bounds)
    this.win.webContents.send(IPC.overlayOpen)
  }

  hide(): void {
    if (!this.win) return
    this.win.webContents.send(IPC.overlayClosed)
    this.win.hide()
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }
}
