import { describe, expect, it } from 'vitest'
import {
  SettingsPatchSchema,
  SettingsSchema,
  applySettingsPatch,
  migrateSettings
} from '../src/schemas/settings'
import { DEFAULT_SETTINGS } from '../src/types/settings'

describe('migrateSettings', () => {
  it('returns defaults for missing or garbage input', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings([1, 2])).toEqual(DEFAULT_SETTINGS)
  })

  it('upgrades a legacy v1 file: keeps valid fields, drops the Claude model', () => {
    const legacy = {
      model: 'claude-sonnet-5-5',
      summonHotkey: 'CommandOrControl+Shift+H',
      captureHotkey: 'CommandOrControl+Alt+Space',
      launchAtLogin: true,
      saveHistory: false,
      restorePins: true,
      clipboardHint: true,
      translateTo: 'German',
      collapseToDotAfterMs: 10_000,
      pillAnchor: { x: 10, y: 20 },
      studioBounds: null,
      onboardingDone: true
    }
    const s = migrateSettings(legacy)
    expect(s.schemaVersion).toBe(2)
    expect(s.model).toBe(DEFAULT_SETTINGS.model)
    expect(s.summonHotkey).toBe('CommandOrControl+Shift+H')
    expect(s.saveHistory).toBe(false)
    expect(s.translateTo).toBe('German')
    expect(s.pillAnchor).toEqual({ x: 10, y: 20 })
    expect(s.onboardingDone).toBe(true)
    expect(s.lens).toEqual(DEFAULT_SETTINGS.lens)
    expect(SettingsSchema.safeParse(s).success).toBe(true)
  })

  it('replaces only the invalid fields', () => {
    const s = migrateSettings({
      ...DEFAULT_SETTINGS,
      collapseToDotAfterMs: -5,
      translateTo: 'French',
      lens: { ...DEFAULT_SETTINGS.lens, sensitivity: 7, enabled: true }
    })
    expect(s.collapseToDotAfterMs).toBe(DEFAULT_SETTINGS.collapseToDotAfterMs)
    expect(s.translateTo).toBe('French')
    expect(s.lens.sensitivity).toBe(0)
    expect(s.lens.enabled).toBe(true)
  })

  it('drops unknown keys', () => {
    const s = migrateSettings({ ...DEFAULT_SETTINGS, evil: true }) as unknown as Record<
      string,
      unknown
    >
    expect('evil' in s).toBe(false)
  })
})

describe('SettingsPatchSchema', () => {
  it('accepts user-editable fields and nested lens changes', () => {
    const r = SettingsPatchSchema.safeParse({
      model: 'gemini-4-argon',
      lens: { mode: 'ask', sites: { 'example.com': 'paused', 'old.org': null } }
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown keys and main-managed fields', () => {
    for (const bad of [
      { onboardingDone: true },
      { pillAnchor: { x: 1, y: 2 } },
      { schemaVersion: 3 },
      { lens: { surprise: 1 } },
      { model: 'claude-opus-5-5' },
      { lens: { sites: { '../etc': 'never' } } }
    ]) {
      expect(SettingsPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('applySettingsPatch', () => {
  const base = {
    ...DEFAULT_SETTINGS,
    lens: {
      ...DEFAULT_SETTINGS.lens,
      sites: { 'a.com': 'paused' as const, 'b.com': 'never' as const },
      languages: { primary: 'en', comfortable: ['de'] }
    }
  }

  it('merges top-level and lens fields without mutating the input', () => {
    const before = structuredClone(base)
    const next = applySettingsPatch(base, {
      translateTo: 'Spanish',
      lens: { enabled: true, languages: { comfortable: ['fr'] } }
    })
    expect(base).toEqual(before)
    expect(next.translateTo).toBe('Spanish')
    expect(next.lens.enabled).toBe(true)
    expect(next.lens.languages).toEqual({ primary: 'en', comfortable: ['fr'] })
    expect(next.lens.sites).toEqual(base.lens.sites)
  })

  it('adds, changes and deletes (null) site rules', () => {
    const next = applySettingsPatch(base, {
      lens: { sites: { 'a.com': null, 'b.com': 'always', 'c.com': 'paused' } }
    })
    expect(next.lens.sites).toEqual({ 'b.com': 'always', 'c.com': 'paused' })
  })

  it('ignores keys explicitly set to undefined', () => {
    const next = applySettingsPatch(base, { translateTo: undefined, lens: { mode: undefined } })
    expect(next).toEqual(base)
  })
})
