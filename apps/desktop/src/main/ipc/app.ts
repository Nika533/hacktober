import { shell } from 'electron'
import { handleInvoke } from './handle'

const ALLOWED_EXTERNAL_HOSTS = [
  'aistudio.google.com',
  'ai.google.dev',
  'support.google.com',
  'github.com'
]

/** Exact host, or a subdomain of an allowed host; https only. */
export function isAllowedExternal(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  return ALLOWED_EXTERNAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

export function registerAppIpc(): void {
  handleInvoke('app:openExternal', async (_sender, url) => {
    if (!isAllowedExternal(url)) throw new Error('url not allowed')
    await shell.openExternal(url)
  })
}
