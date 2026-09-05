import type { GenerationJsonSchema, JsonObject } from '@generation'
import { Switch } from '@shared'
import { validateProjectId } from '../project-command'

/** CreationFieldType is the closed vocabulary a created entity's fields draw from. */
export type CreationFieldType = 'text' | 'number' | 'yesno' | 'time'

const creationFieldTypes: readonly CreationFieldType[] = ['text', 'number', 'yesno', 'time']

/** CreationField is one entity field; exactly one text field per entity carries `title`. */
export type CreationField = {
  name: string
  type: CreationFieldType
  title?: boolean
}

/** CreationEntity is one stored entity and the feature folder built around it. */
export type CreationEntity = {
  plural: string
  singular: string
  purpose: string
  fields: CreationField[]
}

/** CreationPalette is the three colors a design is derived from. */
export type CreationPalette = {
  canvas: string
  ink: string
  accent: string
}

type CreationSampleValue = boolean | number | string
export type CreationSampleRow = Record<string, CreationSampleValue>

/**
 * CreationPlan is the typed intent `tao create` lowers into a project. A model fills it one small
 * question at a time or all at once; Tao validates it and decides every placement.
 */
export type CreationPlan = {
  name: string
  id: string
  summary: string
  entities: CreationEntity[]
  palette: CreationPalette
  /** Sample rows per entity, keyed by the entity's plural name. */
  samples: Record<string, CreationSampleRow[]>
}

export const MAX_ENTITIES = 4
export const MAX_FIELDS = 8
const MAX_SAMPLE_ROWS = 5

const IDENTIFIER = /^[A-Z][A-Za-z0-9]*$/u
const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/u
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u
/** Sample text is written into Tao string literals and test steps, where these characters have meaning. */
const UNSAFE_SAMPLE_TEXT = /["\\{}\u0000-\u001f\u007f]/u

/** Names the generated files import from the stdlib or bind locally; an entity may not shadow them. */
const RESERVED_IDENTIFIERS = new Set([
  'Checkbox',
  'Col',
  'FormButton',
  'Local',
  'Message',
  'ScrollView',
  'SelectionNav',
  'Spinner',
  'StackNav',
  'Text',
  'TextInput',
  'TextMultiline',
  'Value',
])

/** Entity handles expose these members, so a field may not take their names. */
const RESERVED_FIELD_NAMES = new Set(['Count', 'Id'])

export type ValidateCreationPlanOptions = {
  /** false skips field checks, for an outline whose fields are asked for separately. */
  fields?: boolean
  /** false skips sample checks, for a plan whose rows are asked for separately. */
  samples?: boolean
}

/** validateCreationPlan returns every reason a plan cannot be lowered; an empty list means it can. */
export function validateCreationPlan(plan: CreationPlan, options: ValidateCreationPlanOptions = {}): string[] {
  const issues: string[] = []
  if (plan.name.trim().length === 0 || plan.name.length > 40 || /[\u0000-\u001f\u007f]/u.test(plan.name)) {
    issues.push('name must be 1 to 40 characters without control characters.')
  } else if (UNSAFE_SAMPLE_TEXT.test(plan.name)) {
    issues.push('name may not contain quotes, backslashes, or braces.')
  }
  issues.push(...projectIdIssues(plan.id))
  if (plan.summary.trim().length === 0 || plan.summary.length > 200) {
    issues.push('summary must be one sentence of at most 200 characters.')
  }
  issues.push(...paletteIssues(plan.palette))

  if (plan.entities.length === 0 || plan.entities.length > MAX_ENTITIES) {
    issues.push(`entities must list 1 to ${MAX_ENTITIES} entities.`)
  }
  const app = appIdentifier(plan.name)
  const declared = new Map<string, string>([[app, 'the app']])
  const claim = (name: string, what: string) => {
    const owner = declared.get(name)
    if (owner !== undefined) {
      issues.push(`${what} is named ${name}, which is already ${owner}.`)
    } else {
      declared.set(name, what)
    }
  }
  for (const entity of plan.entities) {
    for (const [role, name] of [['plural', entity.plural], ['singular', entity.singular]] as const) {
      if (!IDENTIFIER.test(name) || name.length > 30) {
        issues.push(`entity ${role} '${name}' must be a PascalCase word of at most 30 characters.`)
      } else if (RESERVED_IDENTIFIERS.has(name)) {
        issues.push(`entity ${role} '${name}' is reserved by the generated app.`)
      }
    }
    if (entity.plural === entity.singular) {
      issues.push(`entity '${entity.plural}' needs a plural and a singular that differ.`)
    }
    if (entity.purpose.trim().length === 0) {
      issues.push(`entity '${entity.plural}' needs a one-line purpose.`)
    }
    claim(entity.plural, 'an entity collection')
    claim(entity.singular, 'an entity')
    for (const derived of derivedDeclarationNames(entity)) {
      claim(derived, `generated for ${entity.plural}`)
    }
    if (options.fields !== false) {
      issues.push(...entityFieldIssues(entity))
    }
    if (options.samples !== false) {
      issues.push(...sampleRowIssues(entity, plan.samples[entity.plural]))
    }
  }
  for (const derived of [`${app}Navigator`, `${app}Design`]) {
    claim(derived, 'generated for the app')
  }
  return issues
}

/** paletteIssues rejects colors that are not six-digit hex. */
export function paletteIssues(palette: CreationPalette): string[] {
  const issues: string[] = []
  for (const [key, color] of Object.entries(palette)) {
    if (!HEX_COLOR.test(color)) {
      issues.push(`palette.${key} must be a six-digit hex color such as #3f6f9a.`)
    }
  }
  return issues
}

/** projectIdIssues rejects ids the create command cannot use as a checked-in id and directory name. */
export function projectIdIssues(id: string): string[] {
  try {
    validateProjectId(id)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  if (!PROJECT_ID.test(id) || id.length > 64) {
    return [`id '${id}' must be lowercase letters, digits, and hyphens, such as 'my-notes'.`]
  }
  return []
}

/** entityFieldIssues checks one entity's fields on their own, for the stepwise pipeline. */
export function entityFieldIssues(entity: CreationEntity): string[] {
  const issues: string[] = []
  const prefix = `entity '${entity.plural}'`
  if (entity.fields.length === 0 || entity.fields.length > MAX_FIELDS) {
    issues.push(`${prefix} must declare 1 to ${MAX_FIELDS} fields.`)
  }
  const seen = new Set<string>()
  for (const field of entity.fields) {
    if (!IDENTIFIER.test(field.name) || field.name.length > 30) {
      issues.push(`${prefix} field '${field.name}' must be a PascalCase word of at most 30 characters.`)
    } else if (RESERVED_FIELD_NAMES.has(field.name)) {
      issues.push(`${prefix} field '${field.name}' is reserved.`)
    } else if (field.name === entity.singular || field.name === entity.plural) {
      issues.push(`${prefix} field '${field.name}' may not repeat the entity name.`)
    }
    if (seen.has(field.name)) {
      issues.push(`${prefix} declares field '${field.name}' twice.`)
    }
    seen.add(field.name)
    if (!creationFieldTypes.includes(field.type)) {
      issues.push(`${prefix} field '${field.name}' has unknown type '${String(field.type)}'.`)
    }
  }
  const titles = entity.fields.filter(field => field.title === true)
  if (titles.length !== 1) {
    issues.push(`${prefix} must mark exactly one text field as the title.`)
  } else if (titles[0]!.type !== 'text') {
    issues.push(`${prefix} title field '${titles[0]!.name}' must be a text field.`)
  }
  return issues
}

/** sampleRowIssues checks proposed rows against the entity's fields, for the stepwise pipeline. */
export function sampleRowIssues(entity: CreationEntity, rows: CreationSampleRow[] | undefined): string[] {
  const prefix = `samples for '${entity.plural}'`
  if (rows === undefined || rows.length === 0 || rows.length > MAX_SAMPLE_ROWS) {
    return [`${prefix} must hold 1 to ${MAX_SAMPLE_ROWS} rows.`]
  }
  const issues: string[] = []
  const fields = new Map(entity.fields.map(field => [field.name, field]))
  const title = titleFieldOf(entity)
  const titles = new Set<string>()
  rows.forEach((row, index) => {
    const where = `${prefix} row ${index + 1}`
    for (const [name, value] of Object.entries(row)) {
      const field = fields.get(name)
      if (field === undefined) {
        issues.push(`${where} sets unknown field '${name}'.`)
        continue
      }
      if (!sampleValueFits(field, value)) {
        issues.push(`${where} field '${name}' must be a ${field.type} value.`)
      }
      if (typeof value === 'string' && UNSAFE_SAMPLE_TEXT.test(value)) {
        issues.push(`${where} field '${name}' may not contain quotes, backslashes, or braces.`)
      }
    }
    const titleValue = title === undefined ? undefined : row[title.name]
    if (typeof titleValue !== 'string' || titleValue.trim().length === 0 || titleValue.length > 60) {
      issues.push(`${where} needs a ${title?.name ?? 'title'} of 1 to 60 characters.`)
    } else if (titles.has(titleValue)) {
      issues.push(`${where} repeats the ${title!.name} '${titleValue}'.`)
    } else {
      titles.add(titleValue)
    }
  })
  return issues
}

function sampleValueFits(field: CreationField, value: CreationSampleValue): boolean {
  // A model may name a type outside the vocabulary; the field check reports it, the row check just fails.
  if (!creationFieldTypes.includes(field.type)) {
    return false
  }
  return Switch<CreationFieldType, boolean>(field.type, {
    text: () => typeof value === 'string',
    number: () => typeof value === 'number' && Number.isFinite(value),
    yesno: () => typeof value === 'boolean',
    time: () => false,
  })
}

/** derivedDeclarationNames lists the declarations the lowering generates for one entity. */
export function derivedDeclarationNames(entity: CreationEntity): string[] {
  return [`${entity.singular}List`, `${entity.singular}Detail`, `${entity.singular}Row`, `${entity.plural}Stack`]
}

/** titleFieldOf returns the entity's title field when the plan marks exactly one. */
export function titleFieldOf(entity: CreationEntity): CreationField | undefined {
  const titles = entity.fields.filter(field => field.title === true)
  return titles.length === 1 ? titles[0] : undefined
}

/** appIdentifier turns a display name into the PascalCase app declaration name. */
export function appIdentifier(name: string): string {
  const joined = words(name).map(word => word[0]!.toUpperCase() + word.slice(1)).join('')
  const identifier = joined.length === 0 ? 'App' : joined
  return /^[0-9]/u.test(identifier) ? `App${identifier}` : identifier
}

/** suggestProjectId derives the checked-in id from a display name: lowercase words joined by hyphens. */
export function suggestProjectId(name: string): string {
  const slug = words(name).map(word => word.toLowerCase()).join('-').replace(/^-+|-+$/gu, '')
  return slug.length === 0 ? 'app' : slug.slice(0, 64).replace(/-+$/u, '')
}

/** displayNameFromDescription takes the first few words of a description as a name. */
function displayNameFromDescription(description: string): string {
  const picked = words(description).slice(0, 3)
  if (picked.length === 0) {
    return 'App'
  }
  return picked.map(word => word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

function words(text: string): string[] {
  return text.normalize('NFKD').replace(/[^A-Za-z0-9\s-]/gu, '').split(/[\s-]+/u).filter(word => word.length > 0)
}

export type DeterministicPlanOptions = {
  id?: string
  name?: string
  /** A palette read from an image outranks the default even when no model is involved. */
  palette?: CreationPalette
}

/**
 * deterministicPlan builds a runnable plan from a description alone, with no model involved. It is
 * valid by construction: the name is trimmed to fit, and the entity is chosen so that none of the
 * declarations the lowering generates collides with the app's name.
 */
export function deterministicPlan(description: string, options: DeterministicPlanOptions = {}): CreationPlan {
  const name = fitName(options.name ?? displayNameFromDescription(description))
  const entity = plainEntity(appIdentifier(name))
  const summary = description.trim().length === 0
    ? 'Keeps a list of items on this device.'
    : sentence(description.trim().slice(0, 180))
  return {
    name,
    id: options.id ?? suggestProjectId(name),
    summary,
    entities: [entity],
    palette: options.palette ?? DEFAULT_PALETTE,
    samples: {
      [entity.plural]: [
        { Title: 'First item', Notes: 'The first thing worth keeping.' },
        { Title: 'Second item', Done: true },
        { Title: 'Third item' },
      ],
    },
  }
}

export const DEFAULT_PALETTE: CreationPalette = { canvas: '#f6f4ee', ink: '#1f2421', accent: '#3f6f9a' }

const PLAIN_ENTITIES: readonly (readonly [string, string])[] = [
  ['Items', 'Item'],
  ['Entries', 'Entry'],
  ['Records', 'Record'],
  ['Things', 'Thing'],
]

/** plainEntity picks the first plain entity whose names and generated declarations leave the app's alone. */
function plainEntity(app: string): CreationEntity {
  for (const [plural, singular] of PLAIN_ENTITIES) {
    const entity = { plural, singular, purpose: 'One thing the app keeps track of.', fields: defaultFields() }
    const taken = new Set([plural, singular, ...derivedDeclarationNames(entity)])
    if (![app, `${app}Navigator`, `${app}Design`].some(name => taken.has(name))) {
      return entity
    }
  }
  const [plural, singular] = PLAIN_ENTITIES[0]!
  return { plural, singular, purpose: 'One thing the app keeps track of.', fields: defaultFields() }
}

/** fitName drops trailing words until the display name fits the 40-character limit. */
function fitName(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(part => part.length > 0)
  while (parts.length > 1 && parts.join(' ').length > 40) {
    parts.pop()
  }
  const fitted = parts.join(' ').slice(0, 40).trim()
  return fitted.length === 0 ? 'App' : fitted
}

/** defaultFields is the field set an entity falls back to when a model cannot propose a usable one. */
export function defaultFields(): CreationField[] {
  return [
    { name: 'Title', type: 'text', title: true },
    { name: 'Notes', type: 'text' },
    { name: 'Done', type: 'yesno' },
    { name: 'CreatedAt', type: 'time' },
  ]
}

/** fallbackSampleRows numbers three plain rows when a model cannot propose realistic ones. */
export function fallbackSampleRows(entity: CreationEntity): CreationSampleRow[] {
  const title = titleFieldOf(entity)
  if (title === undefined) {
    return []
  }
  const word = entity.singular.replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
  return ['one', 'two', 'three'].map(ordinal => ({ [title.name]: `${word} ${ordinal}` }))
}

function sentence(text: string): string {
  const trimmed = text.replace(/\s+/gu, ' ')
  const capitalized = trimmed[0]!.toUpperCase() + trimmed.slice(1)
  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`
}

// -- Generation schemas ----------------------------------------------------------------------------

const identifierSchema = (description: string): GenerationJsonSchema => ({ type: 'string', description })

const fieldSchema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    name: identifierSchema('PascalCase field name, such as Title or DueDate.'),
    type: {
      type: 'string',
      enum: [...creationFieldTypes],
      description: 'text for words, number for amounts, yesno for a flag, time for a moment.',
    },
    title: { type: 'boolean', description: 'true on exactly one text field: the one that names a row.' },
  },
  required: ['name', 'type'],
  additionalProperties: false,
}

export const fieldsSchema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    fields: { type: 'array', items: fieldSchema, description: `1 to ${MAX_FIELDS} fields.` },
  },
  required: ['fields'],
  additionalProperties: false,
}

const entityOutlineProperties: Record<string, GenerationJsonSchema> = {
  plural: identifierSchema('PascalCase collection name, such as Recipes.'),
  singular: identifierSchema('PascalCase name of one row, such as Recipe.'),
  purpose: { type: 'string', description: 'One short sentence: what one row is.' },
}

export const outlineSchema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short display name for the app, at most three words.' },
    id: { type: 'string', description: 'Lowercase id with hyphens, derived from the name, such as trip-planner.' },
    summary: { type: 'string', description: 'One sentence saying what the app does.' },
    entities: {
      type: 'array',
      description: `1 to ${MAX_ENTITIES} kinds of thing the app stores, most important first.`,
      items: {
        type: 'object',
        properties: entityOutlineProperties,
        required: ['plural', 'singular', 'purpose'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'id', 'summary', 'entities'],
  additionalProperties: false,
}

export const paletteSchema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    canvas: { type: 'string', description: 'Six-digit hex background color, usually light and quiet.' },
    ink: { type: 'string', description: 'Six-digit hex text color with strong contrast against canvas.' },
    accent: { type: 'string', description: 'Six-digit hex brand color for buttons and highlights.' },
  },
  required: ['canvas', 'ink', 'accent'],
  additionalProperties: false,
}

/** wholePlanSchema asks a large-window model for everything but the sample rows in one answer. */
export const wholePlanSchema: GenerationJsonSchema = {
  type: 'object',
  properties: {
    ...outlineSchema.properties,
    entities: {
      type: 'array',
      description: `1 to ${MAX_ENTITIES} kinds of thing the app stores, most important first.`,
      items: {
        type: 'object',
        properties: { ...entityOutlineProperties, ...fieldsSchema.properties },
        required: ['plural', 'singular', 'purpose', 'fields'],
        additionalProperties: false,
      },
    },
    palette: paletteSchema,
  },
  required: ['name', 'id', 'summary', 'entities', 'palette'],
  additionalProperties: false,
}

/** sampleRowsSchema describes the rows a model proposes for one entity. */
export function sampleRowsSchema(entity: CreationEntity): GenerationJsonSchema {
  const properties: Record<string, GenerationJsonSchema> = {}
  const required: string[] = []
  for (const field of entity.fields) {
    if (field.type === 'time') {
      continue
    }
    properties[field.name] = field.type === 'text'
      ? { type: 'string', description: field.title ? 'Short, distinct, realistic.' : 'Realistic text.' }
      : field.type === 'number'
      ? { type: 'number' }
      : { type: 'boolean' }
    if (field.title) {
      required.push(field.name)
    }
  }
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        description: `3 realistic ${entity.plural}.`,
        items: { type: 'object', properties, required, additionalProperties: false },
      },
    },
    required: ['rows'],
    additionalProperties: false,
  }
}

/** planFromJson narrows a JSON object into a CreationPlan shape; validation decides whether it is usable. */
export function planFromJson(value: JsonObject, samples: Record<string, CreationSampleRow[]>): CreationPlan {
  const entities = Array.isArray(value['entities']) ? value['entities'] : []
  return {
    name: text(value['name']),
    id: text(value['id']),
    summary: text(value['summary']),
    entities: entities.map(entity => entityFromJson(isObject(entity) ? entity : {})),
    palette: paletteFromJson(value['palette']),
    samples,
  }
}

export function entityFromJson(value: JsonObject): CreationEntity {
  const fields = Array.isArray(value['fields']) ? value['fields'] : []
  return {
    plural: text(value['plural']),
    singular: text(value['singular']),
    purpose: text(value['purpose']),
    fields: fields.map(field => {
      const object = isObject(field) ? field : {}
      const name = text(object['name'])
      const type = text(object['type']) as CreationFieldType
      return object['title'] === true ? { name, type, title: true } : { name, type }
    }),
  }
}

export function paletteFromJson(value: unknown): CreationPalette {
  const object = isObject(value) ? value : {}
  return { canvas: text(object['canvas']), ink: text(object['ink']), accent: text(object['accent']) }
}

export function sampleRowsFromJson(entity: CreationEntity, value: unknown): CreationSampleRow[] {
  const rows = isObject(value) && Array.isArray(value['rows']) ? value['rows'] : []
  const fields = new Map(entity.fields.map(field => [field.name, field]))
  return rows.flatMap(row => {
    if (!isObject(row)) {
      return []
    }
    const sample: CreationSampleRow = {}
    for (const [name, raw] of Object.entries(row)) {
      const field = fields.get(name)
      if (field === undefined || field.type === 'time' || raw === null || typeof raw === 'object') {
        continue
      }
      if (field.type === 'yesno' && raw === false) {
        continue
      }
      sample[name] = raw
    }
    return [sample]
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
