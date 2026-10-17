import { z } from 'zod'

/**
 * Ids name files on disk (sessions/<id>.json, attachments/<id>.png), so they
 * must never contain dots or separators.
 */
export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid id')

export const PointSchema = z.object({ x: z.number(), y: z.number() })

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative()
})

/** Registrable domain such as "example.com"; "" means a local file. */
export const SiteSchema = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)?$/i, 'invalid site')

export const LangSchema = z.string().min(2).max(35)

export const UnitSchema = z.number().min(0).max(1)

export const TimestampSchema = z.number().int().nonnegative()
