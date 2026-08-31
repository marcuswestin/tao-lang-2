import { Describe, Expect, Test } from '@shared/test'
import {
  AppleOnDeviceGenerationProvider,
  type GenerationJsonSchema,
  type JsonObject,
} from '../generation-src/generation'

const schema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    Title: { type: 'string' },
    Servings: { type: 'number' },
  },
  required: ['Title', 'Servings'],
  additionalProperties: false,
}

Describe('Apple on-device generation provider', () => {
  Test('loads the native binding lazily and adapts guided chunks to partial and final values', async () => {
    let loads = 0
    let request: unknown
    const provider = new AppleOnDeviceGenerationProvider(async () => {
      loads += 1
      return {
        appleAISDK: {
          checkAvailability: async () => ({ available: true, reason: '' }),
        },
        chat: (options) => {
          request = options
          return chunks(['{"Title":"Mush', 'room Toast","Servings":2}'])
        },
      }
    })

    Expect(loads).toBe(0)
    const run = provider.generate<JsonObject>(
      schema,
      [{ name: 'Mood', value: 'cozy' }],
      'Create a realistic recipe.',
    )
    const partials = []
    for await (const partial of run.partials) {
      partials.push(partial)
    }

    Expect(await run.final).toEqual({
      status: 'success',
      value: { Title: 'Mushroom Toast', Servings: 2 },
    })
    Expect(partials).toEqual([{ Title: 'Mushroom Toast', Servings: 2 }])
    Expect(loads).toBe(1)
    Expect(request).toMatchObject({
      schema,
      stream: true,
    })
    Expect((request as { messages: string }).messages).toContain('"Mood":"cozy"')
  })

  Test('declares schema-invalid native output as failure', async () => {
    const provider = new AppleOnDeviceGenerationProvider(async () => ({
      appleAISDK: {
        checkAvailability: async () => ({ available: true, reason: '' }),
      },
      chat: () => chunks(['{"Title":"Incomplete"}']),
    }))

    Expect(await provider.generate(schema, [], 'Generate.').final).toMatchObject({
      status: 'failure',
      code: 'schema_mismatch',
      issues: ['$.Servings is required.'],
    })
  })
})

async function* chunks(values: readonly string[]): AsyncIterableIterator<string> {
  for (const value of values) {
    yield value
  }
}
