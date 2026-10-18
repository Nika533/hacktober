import { shell } from 'electron'
import { handleInvoke } from './handle'

/**
 * Links in model answers (Studio Markdown, the card, sticky notes) all open
 * through here, so there is no host allowlist (rebuild-plan correction #54).
 * What matters for `shell.openExternal` is the scheme: only http(s), and no
 * credentials smuggled into the URL.
 */
export function isAllowedExternal(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username !== '' || u.password !== '') return false
  return u.hostname !== ''
}

export function registerAppIpc(): void {
  handleInvoke('app:openExternal', async (_sender, url) => {
    if (!isAllowedExternal(url)) throw new Error('url not allowed')
    await shell.openExternal(url)
  })
}
