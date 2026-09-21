import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type GenerationJsonSchema,
  type JsonObject,
  listOllamaModels,
  OllamaGenerationProvider,
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

const tags = { models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:latest' }] }

function ollamaFetch(chatContent: string, requests: Request[] = []) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    requests.push(request)
    if (request.url.endsWith('/api/tags')) {
      return Response.json(tags)
    }
    return Response.json({ message: { role: 'assistant', content: chatContent } })
  }
}

Describe('Ollama generation provider', () => {
  Test('lists installed models and reports nothing listening as undefined', async () => {
    Expect(await listOllamaModels({ fetch: ollamaFetch(''), url: 'http://127.0.0.1:11434/' })).toEqual([
      'qwen3:8b',
      'llama3.2:latest',
    ])
    Expect(
      await listOllamaModels({
        fetch: async () => Errors.throwHostEnvironment('connection refused'),
      }),
    ).toBeUndefined()
  })

  Test('asks the chat endpoint for schema-constrained JSON and validates the answer', async () => {
    const requests: Request[] = []
    const provider = new OllamaGenerationProvider({
      fetch: ollamaFetch('```json\n{"Title":"Mushroom Toast","Servings":2}\n```', requests),
      model: 'llama3.2',
    })

    Expect(await provider.availability()).toEqual({ status: 'available' })
    const result = await provider.generate<JsonObject>(schema, [{ name: 'Mood', value: 'cozy' }], 'Create a recipe.')
      .final
    Expect(result).toEqual({ status: 'success', value: { Title: 'Mushroom Toast', Servings: 2 } })

    const chat = requests.find(request => request.url.endsWith('/api/chat'))!
    const body = await chat.json() as {
      format: GenerationJsonSchema
      messages: { content: string; role: string }[]
      model: string
      stream: boolean
    }
    Expect(body.model).toBe('llama3.2')
    Expect(body.stream).toBe(false)
    Expect(body.format.properties).toEqual(schema.properties)
    Expect(body.messages[1]!.content).toContain('Create a recipe.')
    Expect(body.messages[1]!.content).toContain('"Mood":"cozy"')
  })

  Test('reports a missing model, a schema mismatch, and a prose answer as failures', async () => {
    const missing = new OllamaGenerationProvider({ fetch: ollamaFetch(''), model: 'nonexistent' })
    Expect(await missing.availability()).toEqual({
      status: 'unavailable',
      reason: 'Ollama has no model named nonexistent.',
    })

    const mismatch = new OllamaGenerationProvider({ fetch: ollamaFetch('{"Title": 3}'), model: 'qwen3:8b' })
    const mismatched = await mismatch.generate<JsonObject>(schema, [], 'Create a recipe.').final
    Expect(mismatched.status).toBe('failure')
    Expect(mismatched.status === 'failure' && mismatched.code).toBe('schema_mismatch')

    const prose = new OllamaGenerationProvider({ fetch: ollamaFetch('I would rather not.'), model: 'qwen3:8b' })
    const refused = await prose.generate<JsonObject>(schema, [], 'Create a recipe.').final
    Expect(refused).toEqual({ status: 'failure', code: 'provider_error', message: 'Ollama answered without JSON.' })
  })
})
