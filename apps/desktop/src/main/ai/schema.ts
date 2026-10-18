import { z } from 'zod'

/** JSON Schema for a structured answer (Claude's forced tool input), without the `$schema` marker. */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>
  delete json['$schema']
  return json
}
