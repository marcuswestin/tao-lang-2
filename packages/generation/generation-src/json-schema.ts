import { Json } from '@shared/core'
import type { GenerationJsonSchema, JsonValue } from './generation-contract'

export function checkGenerationSchema(
  schema: GenerationJsonSchema,
  value: unknown,
  path = '$',
): readonly string[] {
  const issues: string[] = []

  if (schema.enum && !schema.enum.some((candidate) => jsonEqual(candidate, value))) {
    issues.push(`${path} must be one of ${schema.enum.map(String).join(', ')}.`)
    return issues
  }

  if (!matchesType(schema.type, value)) {
    issues.push(`${path} must be ${schema.type}.`)
    return issues
  }

  if (schema.type === 'object' && Json.isRecord(value)) {
    const properties = schema.properties ?? {}
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        issues.push(`${path}.${required} is required.`)
      }
    }
    for (const [name, child] of Object.entries(properties)) {
      if (name in value) {
        issues.push(...checkGenerationSchema(child, value[name], `${path}.${name}`))
      }
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!(name in properties)) {
          issues.push(`${path}.${name} is not allowed.`)
        }
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      issues.push(...checkGenerationSchema(schema.items as GenerationJsonSchema, item, `${path}[${index}]`))
    })
  }

  return issues
}

function matchesType(type: GenerationJsonSchema['type'], value: unknown): boolean {
  if (type === undefined) {
    return true
  }
  if (type === 'array') {
    return Array.isArray(value)
  }
  if (type === 'object') {
    return Json.isRecord(value)
  }
  if (type === 'integer') {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  return typeof value === type
}

function jsonEqual(left: JsonValue, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
