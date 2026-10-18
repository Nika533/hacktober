import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

/**
 * Placeholder main process from the M0 scaffold: one sandboxed window that
 * shows the Studio stub. d1 replaces this with the real lifecycle and
 * AppContext in D1-10.
 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    title: 'Hoot',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/studio.html`)
  else void win.loadFile(join(__dirname, '../renderer/studio.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  void app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
