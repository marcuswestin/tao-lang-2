import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  generateValidated,
  type GenerationJsonSchema,
  type JsonObject,
  ScriptedGenerationProvider,
  validateGeneratedDraft,
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

Describe('scripted generation and validate gate', () => {
  Test('streams deterministic partials and accepts a schema-valid, entity-valid answer', async () => {
    const provider = new ScriptedGenerationProvider([{
      kind: 'answer',
      partials: [{ Title: 'Mushroom' }],
      value: { Title: 'Mushroom Toast', Servings: 2 },
    }])
    let accepted: JsonObject | undefined
    const run = generateValidated<JsonObject>({
      provider,
      schema,
      inputs: [{ name: 'mood', value: 'cozy' }],
      guide: 'Create a realistic recipe.',
      rules: [{ name: 'positive servings', validate: value => Number(value['Servings']) > 0 }],
      accept: value => {
        accepted = value
      },
    })

    const partials = []
    for await (const partial of run.partials) {
      partials.push(partial)
    }

    Expect(partials).toEqual([{ Title: 'Mushroom' }])
    Expect(await run.final).toEqual({
      status: 'success',
      value: { Title: 'Mushroom Toast', Servings: 2 },
    })
    Expect(accepted).toEqual({ Title: 'Mushroom Toast', Servings: 2 })
    Expect(provider.calls).toEqual([{
      schema,
      inputs: [{ name: 'mood', value: 'cozy' }],
      guide: 'Create a realistic recipe.',
    }])
  })

  Test('rejects invalid scripted answers at the deterministic provider boundary', async () => {
    const provider = new ScriptedGenerationProvider([{
      kind: 'answer',
      value: { Title: 'Missing servings' },
    }])
    const result = await provider.generate(schema, [], 'Generate.').final

    Expect(result).toMatchObject({
      status: 'failure',
      code: 'invalid_scripted_answer',
      issues: ['$.Servings is required.'],
    })
  })

  Test('makes validation failure terminal and never crosses the acceptance boundary', async () => {
    const provider = new ScriptedGenerationProvider([{
      kind: 'answer',
      value: { Title: 'Impossible', Servings: 0 },
    }])
    let accepted = false
    const result = await generateValidated<JsonObject>({
      provider,
      schema,
      inputs: [],
      guide: 'Generate.',
      rules: [{
        name: 'positive servings',
        validate: value => Number(value['Servings']) > 0 || 'Servings must be positive.',
      }],
      accept: () => {
        accepted = true
      },
    }).final

    Expect(result).toEqual({
      status: 'failure',
      code: 'validation_failed',
      message: 'The generated draft failed entity validation.',
      issues: ['Servings must be positive.'],
    })
    Expect(accepted).toBe(false)
  })

  Test('runs schema checking again at the validate gate', async () => {
    const result = await validateGeneratedDraft(
      { Title: 'Unexpected', Servings: 'many' },
      { schema },
    )
    Expect(result).toMatchObject({
      status: 'failure',
      code: 'schema_mismatch',
      issues: ['$.Servings must be number.'],
    })
  })

  Test('rejects additional properties at the validate gate', async () => {
    const result = await validateGeneratedDraft(
      { Title: 'Unexpected', Servings: 2, InternalOnly: true },
      { schema },
    )
    Expect(result).toMatchObject({
      status: 'failure',
      code: 'schema_mismatch',
      issues: ['$.InternalOnly is not allowed.'],
    })
  })

  Test('rejects non-finite numbers as non-JSON values', async () => {
    const result = await validateGeneratedDraft(
      { Title: 'Non-finite', Servings: Number.NaN },
      { schema },
    )
    Expect(result).toMatchObject({
      status: 'failure',
      code: 'schema_mismatch',
      issues: ['$.Servings must be number.'],
    })
  })

  Test('returns scripted failures without retrying or accepting', async () => {
    const provider = new ScriptedGenerationProvider([
      { kind: 'failure', message: 'Model refused the request.' },
      { kind: 'answer', value: { Title: 'Unused', Servings: 1 } },
    ])
    let accepted = false
    const result = await generateValidated<JsonObject>({
      provider,
      schema,
      inputs: [],
      guide: 'Generate.',
      accept: () => {
        accepted = true
      },
    }).final

    Expect(result).toMatchObject({
      status: 'failure',
      code: 'scripted_failure',
      message: 'Model refused the request.',
    })
    Expect(accepted).toBe(false)
    Expect(provider.calls).toHaveLength(1)
  })

  Test('declares an acceptance failure after all draft gates pass', async () => {
    const provider = new ScriptedGenerationProvider([{
      kind: 'answer',
      value: { Title: 'Valid draft', Servings: 2 },
    }])
    const result = await generateValidated<JsonObject>({
      provider,
      schema,
      inputs: [],
      guide: 'Generate.',
      accept: () => {
        Errors.throwHostEnvironment('Storage unavailable.')
      },
    }).final

    Expect(result).toEqual({
      status: 'failure',
      code: 'accept_failed',
      message: 'The generated draft could not be accepted: Storage unavailable.',
      issues: undefined,
    })
  })

  Test('does not consume a scripted answer while unavailable', async () => {
    const provider = new ScriptedGenerationProvider(
      [{ kind: 'answer', value: { Title: 'Still waiting', Servings: 1 } }],
      { status: 'unavailable', reason: 'The on-device model is downloading.' },
    )

    Expect(await provider.generate(schema, [], 'Generate.').final).toEqual({
      status: 'failure',
      code: 'model_unavailable',
      message: 'The on-device model is downloading.',
    })
    provider.setAvailability({ status: 'available' })
    Expect(await provider.generate(schema, [], 'Generate.').final).toEqual({
      status: 'success',
      value: { Title: 'Still waiting', Servings: 1 },
    })
  })
})
