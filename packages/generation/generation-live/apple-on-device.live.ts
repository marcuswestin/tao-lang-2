import { appleAI, appleAISDK } from '@meridius-labs/apple-on-device-ai'
import { Expect, Test } from '@shared/test'
import { generateObject, jsonSchema, streamText } from 'ai'

if (process.env['TAO_LIVE_APPLE_AI'] !== '1') {
  throw new Error('Set TAO_LIVE_APPLE_AI=1 to run live Apple Foundation Models checks.')
}

const documentSchema = {
  type: 'object' as const,
  properties: {
    Workspaces: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          Name: { type: 'string' as const, description: 'A realistic workspace name.' },
          Documents: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                Title: { type: 'string' as const },
                Paragraphs: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: { Body: { type: 'string' as const } },
                    required: ['Body'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['Title', 'Paragraphs'],
              additionalProperties: false,
            },
          },
        },
        required: ['Name', 'Documents'],
        additionalProperties: false,
      },
    },
  },
  required: ['Workspaces'],
  additionalProperties: false,
}

Test(
  'live Apple binding supports availability, AI SDK guided generation, streaming, and realistic entities',
  async () => {
    const availability = await appleAISDK.checkAvailability()
    Expect(availability.available).toBe(true)

    const result = await generateObject({
      model: appleAI('apple-on-device'),
      prompt: 'Generate one realistic writing workspace with two useful documents and two paragraphs each.',
      schema: jsonSchema(documentSchema),
    })
    const generated = result.object as {
      Workspaces: Array<{ Name: string; Documents: Array<{ Title: string; Paragraphs: Array<{ Body: string }> }> }>
    }
    Expect(generated.Workspaces).toHaveLength(1)
    Expect(generated.Workspaces[0]?.Name.length).toBeGreaterThan(2)
    Expect(generated.Workspaces[0]?.Documents).toHaveLength(2)
    Expect(
      generated.Workspaces[0]?.Documents.every((document) =>
        document.Title.length > 2
        && document.Paragraphs.length === 2
        && document.Paragraphs.every((paragraph) => paragraph.Body.length > 20)
      ),
    ).toBe(true)

    const streamed = streamText({
      model: appleAI('apple-on-device'),
      prompt: 'Write one short sentence about a writing studio.',
    })
    const chunks: string[] = []
    for await (const chunk of streamed.textStream) {
      chunks.push(chunk)
    }
    Expect(chunks.length).toBeGreaterThan(0)
    Expect(chunks.join('').length).toBeGreaterThan(10)
  },
)
