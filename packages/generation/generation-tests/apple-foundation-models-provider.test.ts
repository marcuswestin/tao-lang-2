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
    Expect(requestBody).toMatchObject({ deadlineMs: 60_000 })
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

  Test('uses the first terminal event and rejects malformed availability', async () => {
    const provider = new AppleFoundationModelsProvider({
      fetch: async input =>
        String(input).endsWith('/availability')
          ? Response.json({})
          : ndjson([
            { type: 'failure', code: 'provider_error', message: 'First failure.' },
            { type: 'success', value: { Title: 'Too late', Servings: 4 } },
          ]),
      token: 'token',
      url: 'http://127.0.0.1:1',
    })

    Expect(await provider.availability()).toEqual({
      status: 'unavailable',
      reason: 'Foundation Models helper returned an invalid availability response.',
    })
    Expect(await provider.generate(schema, [], 'Generate.').final).toEqual({
      status: 'failure',
      code: 'provider_error',
      message: 'First failure.',
      issues: undefined,
    })
  })

  Test('declares a single-attempt deadline and stops accepting partials', async () => {
    const provider = new AppleFoundationModelsProvider({
      fetch: async () => await new Promise<Response>(() => undefined),
      generationTimeoutMs: 5,
      token: 'token',
      url: 'http://127.0.0.1:1',
    })
    const run = provider.generate(schema, [], 'Generate.')

    Expect(await run.final).toEqual({
      status: 'failure',
      code: 'cancelled',
      message: 'Apple Foundation Models generation exceeded its 5ms deadline.',
      issues: undefined,
    })
    Expect(await collect(run.partials)).toEqual([])
  })

  Test('reports a supervised helper death without making another request', async () => {
    let requests = 0
    const provider = new AppleFoundationModelsProvider({
      fetch: async () => {
        requests += 1
        return Response.json({ status: 'available' })
      },
      helperFailure: () => 'Foundation Models helper exited.',
      token: 'token',
      url: 'http://127.0.0.1:1',
    })

    Expect(await provider.availability()).toEqual({
      status: 'unavailable',
      reason: 'Foundation Models helper exited.',
    })
    Expect(await provider.generate(schema, [], 'Generate.').final).toMatchObject({
      status: 'failure',
      code: 'model_unavailable',
    })
    Expect(requests).toBe(0)
  })

  Test('declares malformed helper events as provider failures', async () => {
    const provider = new AppleFoundationModelsProvider({
      fetch: async () => new Response('{"type":"success"}\n'),
      token: 'token',
      url: 'http://127.0.0.1:1',
    })

    Expect(await provider.generate(schema, [], 'Generate.').final).toEqual({
      status: 'failure',
      code: 'provider_error',
      message: 'Foundation Models helper returned an invalid event.',
      issues: undefined,
    })
  })

  Test('bounds queued partial snapshots when callers only await the final result', async () => {
    const events = Array.from({ length: 70 }, (_, index) => ({
      type: 'partial',
      value: { Title: `Draft ${index}` },
    }))
    const provider = new AppleFoundationModelsProvider({
      fetch: async () =>
        ndjson([
          ...events,
          { type: 'success', value: { Title: 'Final', Servings: 2 } },
        ]),
      token: 'token',
      url: 'http://127.0.0.1:1',
    })
    const run = provider.generate(schema, [], 'Generate.')
    Expect(await run.final).toMatchObject({ status: 'success' })
    const partials = await collect(run.partials)
    Expect(partials).toHaveLength(64)
    Expect(partials[0]).toEqual({ Title: 'Draft 6' })
  })
})

function ndjson(events: readonly unknown[]): Response {
  const body = events.map(event => `${JSON.stringify(event)}\n`).join('')
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
  const collected: Value[] = []
  for await (const value of values) {
    collected.push(value)
  }
  return collected
}
