import { type JsonObject, type ScriptedGeneration, ScriptedGenerationProvider } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import type { CreationBrief } from '../cli-src/create/creation-brief'
import { planCreation } from '../cli-src/create/creation-pipeline'
import { validateCreationPlan } from '../cli-src/create/creation-plan'

const brief: CreationBrief = { description: 'A trip planner for friends', sources: [] }

const answer = (value: JsonObject): ScriptedGeneration => ({ kind: 'answer', value })

const outline = answer({
  name: 'Trip Planner',
  id: 'Trip Planner',
  summary: 'Plans trips with friends.',
  entities: [{ plural: 'Trips', singular: 'Trip', purpose: 'One trip.' }],
})
const goodFields = answer({
  fields: [
    { name: 'Title', type: 'text', title: true },
    { name: 'Days', type: 'number', title: false },
    { name: 'Booked', type: 'yesno', title: false },
  ],
})
const twoTitles = answer({
  fields: [{ name: 'Title', type: 'text', title: true }, { name: 'Where', type: 'text', title: true }],
})
const palette = answer({ canvas: '#ffffff', ink: '#111111', accent: '#ff6600' })
const samples = answer({
  rows: [{ Title: 'Lisbon', Days: 4, Booked: true }, { Title: 'Kyoto', Days: 10, Booked: false }],
})

Describe('tao create pipeline', () => {
  Test('shapes a plan one small question at a time on a narrow window and heals the id', async () => {
    const provider = new ScriptedGenerationProvider([outline, goodFields, palette, samples])
    const result = await planCreation({ brief, provider, window: 'narrow' })

    Expect(result.shapedByModel).toBe(true)
    Expect(result.notes).toEqual([])
    Expect(validateCreationPlan(result.plan)).toEqual([])
    Expect(result.plan.id).toBe('trip-planner')
    Expect(result.plan.entities[0]!.fields.map(field => field.name)).toEqual(['Title', 'Days', 'Booked'])
    Expect(result.plan.palette).toEqual({ canvas: '#ffffff', ink: '#111111', accent: '#ff6600' })
    Expect(result.plan.samples['Trips']).toEqual([{ Title: 'Lisbon', Days: 4, Booked: true }, {
      Title: 'Kyoto',
      Days: 10,
    }])
    Expect(provider.calls.map(call => call.schema.properties && Object.keys(call.schema.properties)[0])).toEqual([
      'name',
      'fields',
      'canvas',
      'rows',
    ])
    Expect(provider.calls[0]!.inputs[0]!.value).toContain('Description: A trip planner for friends')
  })

  Test('re-asks once with the problems named, then falls back to a plain default for that part', async () => {
    const provider = new ScriptedGenerationProvider([outline, twoTitles, goodFields, palette, samples])
    const retried = await planCreation({ brief, provider, window: 'narrow' })
    Expect(retried.shapedByModel).toBe(true)
    Expect(provider.calls[2]!.guide).toContain('The previous answer had these problems')
    Expect(provider.calls[2]!.guide).toContain('exactly one text field as the title')

    // With the plain field set in place, the scripted rows no longer fit their schema either, so the
    // rows fall back too and both fallbacks are reported.
    const exhausted = new ScriptedGenerationProvider([outline, twoTitles, twoTitles, palette, samples, samples])
    const fallback = await planCreation({ brief, provider: exhausted, window: 'narrow' })
    Expect(fallback.shapedByModel).toBe(true)
    Expect(fallback.notes).toEqual([
      'Fields for trips could not be validated; a plain field set is used.',
      'Sample trips could not be validated; plain rows are used.',
    ])
    Expect(fallback.plan.entities[0]!.fields.map(field => field.name)).toEqual(['Title', 'Notes', 'Done', 'CreatedAt'])
    Expect(fallback.plan.samples['Trips']).toEqual([{ Title: 'Trip one' }, { Title: 'Trip two' }, {
      Title: 'Trip three',
    }])
    Expect(validateCreationPlan(fallback.plan)).toEqual([])
  })

  Test('does not re-ask after a provider failure; it records the reason and falls back', async () => {
    const provider = new ScriptedGenerationProvider([
      { kind: 'failure', code: 'cancelled', message: 'Claude Code did not answer within 240000 ms.' },
    ])
    const result = await planCreation({ brief, provider, window: 'wide' })
    Expect(provider.calls).toHaveLength(1)
    Expect(result.shapedByModel).toBe(false)
    Expect(result.notes).toEqual([
      'The model could not answer: Claude Code did not answer within 240000 ms.',
      'The model could not produce an outline that fits Tao; the plain starter is used instead.',
    ])
  })

  Test('uses the plain starter when no outline fits, and says so', async () => {
    const empty = answer({ name: 'Nothing', id: 'nothing', summary: 'Nothing.', entities: [] })
    const provider = new ScriptedGenerationProvider([empty, empty])
    const result = await planCreation({ brief, provider, window: 'narrow', id: 'given-id' })
    Expect(result.shapedByModel).toBe(false)
    Expect(result.notes).toEqual([
      'The model could not produce an outline that fits Tao; the plain starter is used instead.',
    ])
    Expect(result.plan.id).toBe('given-id')
    Expect(validateCreationPlan(result.plan)).toEqual([])
  })

  Test('asks a wide window for everything but the rows at once, and lets an image palette win', async () => {
    const whole = answer({
      name: 'Trip Planner',
      id: 'trip-planner',
      summary: 'Plans trips with friends.',
      entities: [{
        plural: 'Trips',
        singular: 'Trip',
        purpose: 'One trip.',
        fields: [{ name: 'Title', type: 'text', title: true }, { name: 'Days', type: 'number', title: false }, {
          name: 'Booked',
          type: 'yesno',
          title: false,
        }],
      }],
      palette: { canvas: '#ffffff', ink: '#111111', accent: '#ff6600' },
    })
    const provider = new ScriptedGenerationProvider([whole, samples])
    const imagePalette = { canvas: '#fdf6e3', ink: '#073642', accent: '#d33682' }
    const result = await planCreation({
      brief: { ...brief, palette: imagePalette },
      id: 'our-trips',
      provider,
      window: 'wide',
    })
    Expect(result.shapedByModel).toBe(true)
    Expect(provider.calls).toHaveLength(2)
    Expect(result.plan.id).toBe('our-trips')
    Expect(result.plan.palette).toEqual(imagePalette)
    Expect(validateCreationPlan(result.plan)).toEqual([])
  })
})
