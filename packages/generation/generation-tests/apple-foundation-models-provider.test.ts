import { Describe, Expect, Test } from '@shared/test'
import {
  AppleFoundationModelsProvider,
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

Describe('Apple Foundation Models HTTP provider', () => {
  Test('adapts helper availability and streamed structured events', async () => {
    const requests: Request[] = []
    const provider = new AppleFoundationModelsProvider({
      fetch: async (input, init) => {
        const request = new Request(input, init)
        requests.push(request)
        if (request.url.endsWith('/availability')) {
          return Response.json({ status: 'available' })
        }
        return ndjson([
          { type: 'partial', value: { Title: 'Mush' } },
          { type: 'partial', value: { Title: 'Mushroom Toast', Servings: 2 } },
          { type: 'success', value: { Title: 'Mushroom Toast', Servings: 2 } },
        ])
      },
      token: 'secret-token',
      url: 'http://127.0.0.1:43123/',
    })

    Expect(await provider.availability()).toEqual({ status: 'available' })
    const run = provider.generate<JsonObject>(schema, [{ name: 'Mood', value: 'cozy' }], 'Create a recipe.')
    const partials = []
    for await (const partial of run.partials) {
      partials.push(partial)
    }

    Expect(await run.final).toEqual({
      status: 'success',
      value: { Title: 'Mushroom Toast', Servings: 2 },
    })
    Expect(partials).toEqual([
      { Title: 'Mush' },
      { Title: 'Mushroom Toast', Servings: 2 },
    ])
    Expect(requests[0]?.headers.get('authorization')).toBe('Bearer secret-token')
    const requestBody = await requests[1]?.json() as { prompt: string; schema: GenerationJsonSchema }
    Expect(requestBody.schema).toEqual(schema)
    Expect(requestBody.prompt).toContain('"Mood":"cozy"')
  })

  Test('declares helper and schema failures without retrying', async () => {
    const providerFailure = new AppleFoundationModelsProvider({
      fetch: async () => ndjson([{ type: 'failure', code: 'provider_error', message: 'Model failed.' }]),
      token: 'token',
      url: 'http://127.0.0.1:1',
    })
    Expect(await providerFailure.generate(schema, [], 'Generate.').final).toMatchObject({
      status: 'failure',
      code: 'provider_error',
      message: 'Model failed.',
    })

    const invalidValue = new AppleFoundationModelsProvider({
      fetch: async () => ndjson([{ type: 'success', value: { Title: 'Incomplete' } }]),
      token: 'token',
      url: 'http://127.0.0.1:1',
    })
    Expect(await invalidValue.generate(schema, [], 'Generate.').final).toMatchObject({
      status: 'failure',
      code: 'schema_mismatch',
      issues: ['$.Servings is required.'],
    })
  })
})

function ndjson(events: readonly unknown[]): Response {
  const body = events.map(event => `${JSON.stringify(event)}\n`).join('')
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
}
