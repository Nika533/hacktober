import { app } from 'electron'
import type { ApiKeyResult, SettingsPatch } from '@hoot/core'
import { applySettingsPatch } from '@hoot/core/schemas'
import { createGeminiProvider, mapAiError } from '../ai'
import type { AppContext } from '../context'
import type { SecretStore } from '../secrets'
import type { Store } from '../store/store'
import { handleInvoke } from './handle'

/** Validate a key against Gemini (or accept obviously-fake keys under HOOT_FAKE_AI). */
export function makeValidator(env: { fakeAi: boolean }): (key: string) => Promise<boolean> {
  return env.fakeAi
    ? async (key) => key.startsWith('fake-') || key.length >= 8
    : (key) => createGeminiProvider(key).validateKey(key)
}

/** Pure-ish handler bodies (injected deps) so tests never import Electron. */
export async function setApiKeyFlow(
  deps: { store: Store; secrets: SecretStore; validate: (key: string) => Promise<boolean> },
  key: string
): Promise<ApiKeyResult> {
  try {
    if (!(await deps.validate(key))) return { ok: false, reason: 'rejected' }
  } catch (e) {
    const code = mapAiError(e)
    return { ok: false, reason: code === 'network' || code === 'busy' ? 'unreachable' : 'rejected' }
  }
  const keyStorage = await deps.secrets.set(key)
  deps.store.update('settings', { hasApiKey: true, keyStorage })
  return { ok: true }
}

export function applySettingsUpdate(
  deps: { store: Store; setLoginItem?: (openAtLogin: boolean) => void },
  patch: SettingsPatch
): void {
  const current = deps.store.get('settings').settings
  deps.store.update('settings', { settings: applySettingsPatch(current, patch) })
  if (patch.launchAtLogin !== undefined && patch.launchAtLogin !== current.launchAtLogin) {
    deps.setLoginItem?.(patch.launchAtLogin)
  }
}

export function registerSettingsIpc(ctx: AppContext): void {
  const validate = makeValidator(ctx.env)

  handleInvoke('settings:update', (_s, patch) => {
    applySettingsUpdate(
      {
        store: ctx.store,
        setLoginItem: (openAtLogin) => {
          if (app.isPackaged) app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })
        }
      },
      patch
    )
  })

  handleInvoke('settings:validateApiKey', (_s, key) => validate(key))

  handleInvoke('settings:setApiKey', (_s, key) =>
    setApiKeyFlow({ store: ctx.store, secrets: ctx.secrets, validate }, key)
  )

  handleInvoke('settings:clearApiKey', async () => {
    await ctx.secrets.clear()
    ctx.store.update('settings', { hasApiKey: ctx.secrets.get() !== null })
  })

  handleInvoke('settings:resetAnchor', () => {
    const settings = ctx.store.get('settings').settings
    ctx.store.update('settings', { settings: { ...settings, pillAnchor: null } })
  })
}
