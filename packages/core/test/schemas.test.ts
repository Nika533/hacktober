import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import {
  AttachmentSchema,
  MessageSchema,
  PinSchema,
  SessionMetaSchema,
  SessionSchema,
  migrateMessageError
} from '../src/schemas/chat'
import { IdSchema, SiteSchema } from '../src/schemas/common'
import {
  AssessResultSchema,
  LensContextSchema,
  LensEventSchema,
  ProfilePatchSchema,
  ProfileSnapshotSchema,
  ReaderProfileSchema,
  RewriteRequestSchema,
  RewriteResultSchema
} from '../src/schemas/lens'
import { LensSettingsSchema, SettingsSchema } from '../src/schemas/settings'
import { lensCacheKey } from '../src/lens/cacheKey'
import type { Pin } from '../src/types/app'
import type { Attachment, Message, Session, SessionMeta } from '../src/types/chat'
import type {
  AssessResult,
  LensContext,
  LensEvent,
  ProfilePatch,
  ProfileSnapshot,
  ReaderProfile,
  RewriteRequest,
  RewriteResult
} from '../src/types/lens'
import type { LensSettings, Settings } from '../src/types/settings'

describe('schemas match the TypeScript contracts', () => {
  it('chat', () => {
    expectTypeOf<z.output<typeof AttachmentSchema>>().toEqualTypeOf<Attachment>()
    expectTypeOf<z.output<typeof MessageSchema>>().toEqualTypeOf<Message>()
    expectTypeOf<z.output<typeof SessionSchema>>().toEqualTypeOf<Session>()
    expectTypeOf<z.output<typeof SessionMetaSchema>>().toEqualTypeOf<SessionMeta>()
    expectTypeOf<z.output<typeof PinSchema>>().toEqualTypeOf<Pin>()
  })

  it('settings', () => {
    expectTypeOf<z.output<typeof SettingsSchema>>().toEqualTypeOf<Settings>()
    expectTypeOf<z.output<typeof LensSettingsSchema>>().toEqualTypeOf<LensSettings>()
  })

  it('lens', () => {
    expectTypeOf<z.output<typeof LensContextSchema>>().toEqualTypeOf<LensContext>()
    expectTypeOf<z.output<typeof RewriteRequestSchema>>().toEqualTypeOf<RewriteRequest>()
    expectTypeOf<z.output<typeof RewriteResultSchema>>().toEqualTypeOf<RewriteResult>()
    expectTypeOf<z.output<typeof AssessResultSchema>>().toEqualTypeOf<AssessResult>()
    expectTypeOf<z.output<typeof LensEventSchema>>().toEqualTypeOf<LensEvent>()
    expectTypeOf<z.output<typeof ReaderProfileSchema>>().toEqualTypeOf<ReaderProfile>()
    expectTypeOf<z.output<typeof ProfileSnapshotSchema>>().toEqualTypeOf<ProfileSnapshot>()
    expectTypeOf<z.output<typeof ProfilePatchSchema>>().toEqualTypeOf<ProfilePatch>()
  })
})

describe('IdSchema', () => {
  it('allows uuids and slugs, refuses anything path-like', () => {
    expect(IdSchema.safeParse(crypto.randomUUID()).success).toBe(true)
    expect(IdSchema.safeParse('s_1-a').success).toBe(true)
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'a.json', 'x'.repeat(65), 'a b']) {
      expect(IdSchema.safeParse(bad).success, bad).toBe(false)
    }
  })
})

describe('SiteSchema', () => {
  it('accepts registrable domains and the empty local-file site', () => {
    for (const ok of ['example.com', 'bbc.co.uk', 'localhost', '']) {
      expect(SiteSchema.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of ['https://example.com', 'a/b', '-x.com', 'x..com']) {
      expect(SiteSchema.safeParse(bad).success, bad).toBe(false)
    }
  })
})

describe('migrateMessageError', () => {
  it('maps legacy codes and tolerates junk', () => {
    expect(migrateMessageError('401')).toBe('auth')
    expect(migrateMessageError('429')).toBe('rate_limited')
    expect(migrateMessageError('529')).toBe('busy')
    expect(migrateMessageError('no-key')).toBe('no_key')
    expect(migrateMessageError('blocked')).toBe('blocked')
    expect(migrateMessageError('weird')).toBe('unknown')
    expect(migrateMessageError(42)).toBe('unknown')
    expect(migrateMessageError(undefined)).toBeUndefined()
  })
})

describe('lensCacheKey', () => {
  const parts = { span: 'API', paragraph: 'An API is…', transform: 'expand', profileVersion: 3 }

  it('is stable and ignores whitespace differences', () => {
    const key = lensCacheKey(parts)
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(lensCacheKey({ ...parts, paragraph: '  An   API is…\n' })).toBe(key)
  })

  it('changes with the transform or the profile version', () => {
    const key = lensCacheKey(parts)
    expect(lensCacheKey({ ...parts, transform: 'define' })).not.toBe(key)
    expect(lensCacheKey({ ...parts, profileVersion: 4 })).not.toBe(key)
  })
})
