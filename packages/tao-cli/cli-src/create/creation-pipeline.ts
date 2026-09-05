import {
  generateValidated,
  type GenerationInput,
  type GenerationJsonSchema,
  type GenerationProvider,
  type JsonObject,
  type JsonValue,
} from '@generation'
import { briefPrompt, type CreationBrief } from './creation-brief'
import type { CreationWindow } from './creation-lanes'
import {
  type CreationEntity,
  type CreationField,
  type CreationPlan,
  DEFAULT_PALETTE,
  defaultFields,
  deterministicPlan,
  entityFieldIssues,
  entityFromJson,
  fallbackSampleRows,
  fieldsSchema,
  MAX_ENTITIES,
  MAX_FIELDS,
  outlineSchema,
  paletteFromJson,
  paletteIssues,
  paletteSchema,
  planFromJson,
  projectIdIssues,
  sampleRowIssues,
  sampleRowsFromJson,
  sampleRowsSchema,
  suggestProjectId,
  validateCreationPlan,
  wholePlanSchema,
} from './creation-plan'

export type PlanCreationOptions = {
  brief: CreationBrief
  /** A caller-supplied id wins over anything the model proposes. */
  id?: string
  provider: GenerationProvider
  /** Reports progress in plain words, one line per model question. */
  report?: (message: string) => void
  window: CreationWindow
}

export type PlanCreationResult = {
  /** Honest notes about anything that fell back to a plain default. */
  notes: string[]
  plan: CreationPlan
  /** false when nothing the model said survived validation and the plain starter was used instead. */
  shapedByModel: boolean
}

type Ask = <Value extends JsonValue>(
  schema: GenerationJsonSchema,
  inputs: readonly GenerationInput[],
  guide: string,
  validate: (value: Value) => readonly string[],
) => Promise<Value | undefined>

const WIDE_BRIEF_CHARS = 12_000
const NARROW_BRIEF_CHARS = 1_200

const NAMING_RULES = [
  `Entities are the 1 to ${MAX_ENTITIES} kinds of thing the app stores, most important first, each with a PascalCase plural and singular that differ (Recipes / Recipe).`,
  `Each entity has 1 to ${MAX_FIELDS} fields with PascalCase names and a type from text, number, yesno, time; exactly one text field per entity is marked title: true and names a row. Never add an Id or Count field.`,
].join(' ')

const WHOLE_GUIDE = [
  "You are shaping a new mobile app from a person's description. Give it a short display name, a lowercase hyphenated id derived from the name, and a one-sentence summary.",
  NAMING_RULES,
  'Choose three six-digit hex colors: a quiet canvas background, an ink color with strong contrast on it, and an accent for buttons. Keep every text short and concrete.',
].join(' ')

const OUTLINE_GUIDE = [
  "You are shaping a new mobile app from a person's description. Give it a short display name, a lowercase hyphenated id derived from the name, a one-sentence summary, and its entities.",
  `Entities are the 1 to ${MAX_ENTITIES} kinds of thing the app stores, most important first, each with a PascalCase plural and singular that differ (Recipes / Recipe) and a one-line purpose.`,
].join(' ')

const FIELDS_GUIDE =
  `List this entity's fields: 1 to ${MAX_FIELDS}, PascalCase names, each typed text, number, yesno, or time. Exactly one text field is the title that names a row; mark it title: true. Never add an Id or Count field.`

const PALETTE_GUIDE =
  'Pick three six-digit hex colors for this app: canvas (a quiet background), ink (text with strong contrast on canvas), and accent (buttons and highlights).'

const SAMPLES_GUIDE =
  'Write 3 realistic sample rows for this entity. Each row has a short, distinct title. Plain text only: no quotes, braces, or backslashes.'

/**
 * planCreation asks the model for a plan in the shape its window allows: one or two questions for a
 * wide window, one small question per part for a narrow one. Every answer is validated, re-asked once
 * with the problems named, and replaced by a plain default when it still does not fit. The model
 * names the shape; Tao decides every placement.
 */
export async function planCreation(options: PlanCreationOptions): Promise<PlanCreationResult> {
  const notes: string[] = []
  const report = options.report ?? (() => undefined)
  const prompt = briefPrompt(options.brief, options.window === 'wide' ? WIDE_BRIEF_CHARS : NARROW_BRIEF_CHARS)
  const ask = createAsker(options.provider, notes)
  const draft = options.window === 'wide'
    ? await wholePlan(ask, prompt, options, report)
    : await stepwisePlan(ask, prompt, options, notes, report)
  if (draft === undefined) {
    notes.push('The model could not produce an outline that fits Tao; the plain starter is used instead.')
    return { notes, plan: plainPlan(options), shapedByModel: false }
  }

  for (const entity of draft.entities) {
    report(`Asking for sample ${entity.plural.toLowerCase()}`)
    const rows = await ask<JsonObject>(
      sampleRowsSchema(entity),
      [{ name: 'app', value: `${draft.name}: ${draft.summary}` }, { name: 'entity', value: describeEntity(entity) }],
      SAMPLES_GUIDE,
      value => sampleRowIssues(entity, sampleRowsFromJson(entity, value)),
    )
    if (rows === undefined) {
      notes.push(`Sample ${entity.plural.toLowerCase()} could not be validated; plain rows are used.`)
      draft.samples[entity.plural] = fallbackSampleRows(entity)
    } else {
      draft.samples[entity.plural] = sampleRowsFromJson(entity, rows)
    }
  }

  const issues = validateCreationPlan(draft)
  if (issues.length > 0) {
    notes.push(`The shaped plan does not fit Tao (${issues[0]}); the plain starter is used instead.`)
    return { notes, plan: plainPlan(options), shapedByModel: false }
  }
  return { notes, plan: draft, shapedByModel: true }
}

async function wholePlan(
  ask: Ask,
  prompt: string,
  options: PlanCreationOptions,
  report: (message: string) => void,
): Promise<CreationPlan | undefined> {
  report('Asking for the app outline, fields, and colors')
  const value = await ask<JsonObject>(
    wholePlanSchema,
    [{ name: 'brief', value: prompt }],
    WHOLE_GUIDE,
    value => validateCreationPlan(normalizeDraft(planFromJson(value, {}), options), { samples: false }),
  )
  return value === undefined ? undefined : normalizeDraft(planFromJson(value, {}), options)
}

async function stepwisePlan(
  ask: Ask,
  prompt: string,
  options: PlanCreationOptions,
  notes: string[],
  report: (message: string) => void,
): Promise<CreationPlan | undefined> {
  report('Asking for the app outline')
  const outline = await ask<JsonObject>(
    outlineSchema,
    [{ name: 'brief', value: prompt }],
    OUTLINE_GUIDE,
    value => validateCreationPlan(normalizeDraft(planFromJson(value, {}), options), { fields: false, samples: false }),
  )
  if (outline === undefined) {
    return undefined
  }
  const draft = normalizeDraft(planFromJson(outline, {}), options)
  const app = `${draft.name}: ${draft.summary}`

  for (const entity of draft.entities) {
    report(`Asking for the fields of ${entity.plural.toLowerCase()}`)
    const answer = await ask<JsonObject>(
      fieldsSchema,
      [{ name: 'app', value: app }, {
        name: 'entity',
        value: `${entity.plural} / ${entity.singular}: ${entity.purpose}`,
      }],
      FIELDS_GUIDE,
      value => entityFieldIssues({ ...entity, fields: fieldsFromJson(value) }),
    )
    if (answer === undefined) {
      notes.push(`Fields for ${entity.plural.toLowerCase()} could not be validated; a plain field set is used.`)
      entity.fields = defaultFields()
    } else {
      entity.fields = fieldsFromJson(answer)
    }
  }

  if (options.brief.palette === undefined) {
    report('Asking for colors')
    const palette = await ask<JsonObject>(
      paletteSchema,
      [{ name: 'app', value: app }],
      PALETTE_GUIDE,
      value => paletteIssues(paletteFromJson(value)),
    )
    if (palette === undefined) {
      notes.push('Colors could not be validated; the default palette is used.')
      draft.palette = DEFAULT_PALETTE
    } else {
      draft.palette = paletteFromJson(palette)
    }
  }
  return draft
}

/**
 * normalizeDraft applies what outranks the model — the caller's id and an image's palette — and heals
 * the two slots a model most often gets slightly wrong rather than failing the whole answer for them.
 */
function normalizeDraft(plan: CreationPlan, options: PlanCreationOptions): CreationPlan {
  if (options.id !== undefined) {
    plan.id = options.id
  } else if (projectIdIssues(plan.id).length > 0 && plan.name.trim().length > 0) {
    plan.id = suggestProjectId(plan.name)
  }
  if (options.brief.palette !== undefined) {
    plan.palette = options.brief.palette
  } else if (paletteIssues(plan.palette).length > 0) {
    plan.palette = DEFAULT_PALETTE
  }
  return plan
}

function fieldsFromJson(value: JsonObject): CreationField[] {
  return entityFromJson({ plural: 'Rows', singular: 'Row', purpose: '', fields: value['fields'] ?? [] }).fields
}

function describeEntity(entity: CreationEntity): string {
  const fields = entity.fields.map(field => `${field.name} (${field.type}${field.title ? ', title' : ''})`).join(', ')
  return `${entity.plural} / ${entity.singular}: ${entity.purpose} Fields: ${fields}.`
}

/** plainPlan is the fallback when the model's answers cannot be used; an image palette still applies. */
function plainPlan(options: PlanCreationOptions): CreationPlan {
  return deterministicPlan(options.brief.description, {
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.brief.palette === undefined ? {} : { palette: options.brief.palette }),
  })
}

/** Only an answer that reached Tao and did not fit is worth re-asking; a provider failure is not. */
const RETRYABLE_FAILURES = new Set(['invalid_scripted_answer', 'schema_mismatch', 'validation_failed'])

/**
 * createAsker wraps the provider in the validate gate: one attempt, then one retry that names the
 * problems, then undefined so the caller can fall back honestly. A provider failure (a timeout, a
 * crash, an unavailable model) is not retried; its reason is recorded instead.
 */
function createAsker(provider: GenerationProvider, notes: string[]): Ask {
  return async <Value extends JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
    validate: (value: Value) => readonly string[],
  ): Promise<Value | undefined> => {
    let currentGuide = guide
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = generateValidated<Value>({
        provider,
        schema,
        inputs,
        guide: currentGuide,
        rules: [{ name: 'fits the Tao plan', validate: value => [...validate(value)] }],
      })
      void drain(run.partials)
      const result = await run.final
      if (result.status === 'success') {
        return result.value
      }
      if (!RETRYABLE_FAILURES.has(result.code)) {
        notes.push(`The model could not answer: ${result.message}`)
        return undefined
      }
      const problems = result.issues !== undefined && result.issues.length > 0 ? result.issues : [result.message]
      currentGuide = `${guide}\n\nThe previous answer had these problems; fix them:\n${
        problems.slice(0, 8).map(problem => `- ${problem}`).join('\n')
      }`
    }
    return undefined
  }
}

async function drain(partials: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _partial of partials) {
      // Partials are not shown; the stream is consumed so the provider never blocks on them.
    }
  } catch {
    // A failed stream is reported through the final result.
  }
}
