import { AssessModelOutputSchema } from '@hoot/core/schemas'
import { CHAT_MODELS, LENS_MODELS } from '@hoot/core'
import { describe, expect, it } from 'vitest'
import { createGeminiProvider } from '../src/main/ai/gemini'

/**
 * Real Gemini calls: `GEMINI_API_KEY=... npm run test:live` from the repo
 * root. Run at every milestone gate and after any model or prompt change.
 */
const key = process.env['GEMINI_API_KEY'] ?? ''
const live = describe.skipIf(!key)

live('Gemini (live)', () => {
  const ai = createGeminiProvider(key)

  it('accepts the key', async () => {
    await expect(ai.validateKey(key)).resolves.toBe(true)
  })

  for (const model of CHAT_MODELS.filter((m) => !m.paidOnly)) {
    it(`streams a chat answer on ${model.id}`, async () => {
      let text = ''
      const res = await ai.stream(
        {
          model: model.id,
          system: 'Answer in at most five words.',
          maxTokens: 2048,
          signal: AbortSignal.timeout(30_000),
          messages: [{ role: 'user', content: 'Say hello.' }]
        },
        (d) => (text += d)
      )
      expect(text.trim().length).toBeGreaterThan(0)
      expect(res.stopReason).toBe('STOP')
    })
  }

  for (const model of new Set(Object.values(LENS_MODELS))) {
    it(`returns schema-valid JSON on ${model} with minimal thinking`, async () => {
      const out = await ai.generateJson({
        model,
        system: 'Rate how hard the selected text is for a general reader. JSON only.',
        prompt: '<selection>heteroscedasticity</selection>',
        schema: AssessModelOutputSchema,
        thinking: 'minimal'
      })
      expect(AssessModelOutputSchema.safeParse(out).success).toBe(true)
    })
  }
})
