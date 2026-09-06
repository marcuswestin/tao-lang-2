import type { EntityGenerationDeclaration, GenerationField, JsonValue } from '@generation'
import { Assert } from '@shared/core'

type StudioFeedExampleVariant = 'empty' | 'typical' | 'edge'

type StudioFeedExampleRow = Readonly<{
  entity: string
  fields: Readonly<Record<string, JsonValue>>
  name: string
  variant: StudioFeedExampleVariant
}>

type StudioFeedExampleUnsupportedField = Readonly<{
  field: string
  reason: 'inverse-relation' | 'outbound-relation' | 'secret' | 'zero-case-type'
  required: boolean
  target?: string
}>

export type StudioFeedExamplePlan = Readonly<{
  entity: string
  rows: readonly StudioFeedExampleRow[]
  seed: string
  unsupported: readonly StudioFeedExampleUnsupportedField[]
}>

const variants: readonly StudioFeedExampleVariant[] = ['empty', 'typical', 'edge']

/** StudioFeedExamples produces deterministic local feed rows without invoking providers or writing source. */
export const StudioFeedExamples = {
  generate(declaration: EntityGenerationDeclaration, seed: string): StudioFeedExamplePlan {
    Assert.input(seed.length > 0, 'Studio feed example generation requires an explicit seed.')
    const unsupported = declaration.fields.flatMap(unsupportedField)
    return {
      entity: declaration.name,
      rows: variants.map(variant => ({
        entity: declaration.name,
        fields: Object.fromEntries(
          declaration.fields.flatMap(field => {
            const value = exampleValue(field, variant, seed)
            return value === undefined ? [] : [[field.name, value]]
          }),
        ),
        name: `${declaration.name}${titleCase(variant)}`,
        variant,
      })),
      seed,
      unsupported,
    }
  },
} as const

function exampleValue(
  field: GenerationField,
  variant: StudioFeedExampleVariant,
  seed: string,
): JsonValue | undefined {
  if (field.secret || field.type.kind === 'relation') {
    return undefined
  }
  const selected = stableNumber(`${seed}\u0000${field.name}\u0000${variant}`)
  if (field.type.kind === 'case') {
    if (field.type.cases.length === 0) {
      return undefined
    }
    if (variant === 'empty' && field.optional) {
      return ''
    }
    const index = variant === 'empty' ? 0 : variant === 'edge' ? field.type.cases.length - 1 : selected
    return field.type.cases[index % field.type.cases.length]!
  }
  if (field.type.scalar === 'boolean') {
    return variant === 'empty' ? false : variant === 'edge' ? true : selected % 2 === 0
  }
  if (field.type.scalar === 'number') {
    return variant === 'empty' ? 0 : variant === 'edge' ? 1_000_000 + selected % 1_000_000 : 1 + selected % 99
  }
  if (field.type.scalar === 'time') {
    return variant === 'empty'
      ? '1970-01-01T00:00:00.000Z'
      : variant === 'edge'
      ? '2099-12-31T23:59:59.999Z'
      : new Date(Date.UTC(2024, selected % 12, 1 + selected % 28, selected % 24)).toISOString()
  }
  return textValue(field.name, variant, selected)
}

function textValue(name: string, variant: StudioFeedExampleVariant, selected: number): string {
  if (variant === 'empty') {
    return ''
  }
  const key = name.toLowerCase()
  const choice = <Value>(values: readonly Value[]): Value => values[selected % values.length]!
  if (/(avatar|image|photo|picture|cover)/.test(key)) {
    const size = variant === 'edge' ? 1200 : 320
    return `https://placehold.co/${size}x${size}/png?text=${encodeURIComponent(name)}`
  }
  if (/email/.test(key)) {
    return variant === 'edge' ? 'avery.long.address+studio@example.test' : 'alex@example.test'
  }
  if (/(first.?name|given.?name)/.test(key)) {
    return variant === 'edge' ? 'Alexandria' : choice(['Alex', 'Maya', 'Sam'])
  }
  if (/(last.?name|family.?name|surname)/.test(key)) {
    return variant === 'edge' ? 'Montgomery-Williams' : choice(['Chen', 'Diaz', 'Patel'])
  }
  if (/(person|author|owner|customer|member|user|name)/.test(key)) {
    return variant === 'edge' ? 'Alexandria Montgomery-Williams' : choice(['Alex Chen', 'Maya Diaz', 'Sam Patel'])
  }
  if (/(postal|zip)/.test(key)) {
    return variant === 'edge' ? '10001-1234' : '10001'
  }
  if (/address/.test(key)) {
    return variant === 'edge' ? '1847 West Seventy-Second Street, Apartment 1204' : '42 Orchard Street'
  }
  if (/city/.test(key)) {
    return choice(['New York', 'Oakland', 'Portland'])
  }
  if (/state|province/.test(key)) {
    return variant === 'edge' ? 'New York' : 'NY'
  }
  if (/country/.test(key)) {
    return variant === 'edge' ? 'United States of America' : 'United States'
  }
  if (/(description|summary|body|notes|message|content|bio)/.test(key)) {
    return variant === 'edge'
      ? 'A detailed example with enough length to exercise wrapping, truncation, and expanded feed layouts.'
      : 'A concise example for the Studio feed.'
  }
  if (/title|headline|label/.test(key)) {
    return variant === 'edge' ? 'A deliberately long example title for layout stress' : 'Example item'
  }
  return variant === 'edge' ? `${name} with extended example content` : `${name} example`
}

function unsupportedField(field: GenerationField): StudioFeedExampleUnsupportedField[] {
  if (field.secret) {
    return [{ field: field.name, reason: 'secret', required: !field.optional }]
  }
  if (field.type.kind === 'relation') {
    return [{
      field: field.name,
      reason: field.type.inverse ? 'inverse-relation' : 'outbound-relation',
      required: !field.optional,
      target: field.type.entity,
    }]
  }
  if (field.type.kind === 'case' && field.type.cases.length === 0) {
    return [{ field: field.name, reason: 'zero-case-type', required: !field.optional }]
  }
  return []
}

function stableNumber(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function titleCase(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`
}
