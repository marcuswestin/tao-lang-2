import type {
  CompiledGenerationSchema,
  CompileGenerationOptions,
  EntityGenerationDeclaration,
  GenerationDeclaration,
  GenerationField,
  GenerationJsonSchema,
} from './generation-contract'

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

export function compileGenerationSchema(
  declaration: GenerationDeclaration,
  options: CompileGenerationOptions = {},
): CompiledGenerationSchema {
  if (declaration.kind === 'case') {
    return {
      schema: {
        $schema: JSON_SCHEMA_DIALECT,
        title: declaration.name,
        type: 'string',
        enum: declaration.cases,
      },
      guide: `Choose one ${declaration.name} case.`,
      includedFields: [],
    }
  }

  const relations = options.relations ?? []
  const declarations = new Map((options.declarations ?? []).map((candidate) => [candidate.name, candidate]))
  declarations.set(declaration.name, declaration)
  const includedFields: string[] = []
  const schema = compileEntity(declaration, relations, declarations)
  const guidance = declaration.fields
    .filter((field) => !field.secret && (field.type.kind !== 'relation' || relationRequested(relations, field.name)))
    .filter((field) => field.guidance !== undefined)
    .map((field) => `${field.name}: ${field.guidance}`)

  for (const field of declaration.fields) {
    if (!field.secret && (field.type.kind !== 'relation' || relationRequested(relations, field.name))) {
      includedFields.push(field.name)
    }
  }

  return {
    schema: { $schema: JSON_SCHEMA_DIALECT, ...schema },
    guide: [`Generate a ${declaration.name}.`, ...guidance].join('\n'),
    includedFields,
  }
}

function compileEntity(
  declaration: EntityGenerationDeclaration,
  relations: readonly string[],
  declarations: ReadonlyMap<string, GenerationDeclaration>,
): GenerationJsonSchema {
  const properties: Record<string, GenerationJsonSchema> = {}
  const required: string[] = []

  for (const field of declaration.fields) {
    if (field.secret || (field.type.kind === 'relation' && !relationRequested(relations, field.name))) {
      continue
    }

    properties[field.name] = compileField(field, nestedRelationPaths(relations, field.name), declarations)
    if (!field.optional && field.defaultValue === undefined) {
      required.push(field.name)
    }
  }

  return {
    title: declaration.name,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function compileField(
  field: GenerationField,
  relations: readonly string[],
  declarations: ReadonlyMap<string, GenerationDeclaration>,
): GenerationJsonSchema {
  const defaultValue = field.defaultValue
  const metadata = {
    description: field.guidance,
    ...(defaultValue === undefined || (typeof defaultValue === 'object' && defaultValue.kind === 'now')
      ? {}
      : { default: defaultValue }),
  }

  if (field.type.kind === 'scalar') {
    return {
      ...metadata,
      type: field.type.scalar === 'text' || field.type.scalar === 'time'
        ? 'string'
        : field.type.scalar,
    }
  }

  if (field.type.kind === 'case') {
    return { ...metadata, type: 'string', enum: field.type.cases }
  }

  const declaration = declarations.get(field.type.entity)
  if (!declaration) {
    throw new Error(`Generation relation ${field.name} targets unknown entity ${field.type.entity}.`)
  }
  if (declaration.kind !== 'entity') {
    throw new Error(`Generation relation ${field.name} must target an entity, not ${declaration.name}.`)
  }
  const target = compileEntity(declaration, relations, declarations)
  return field.type.inverse
    ? { ...metadata, type: 'array', items: target }
    : { ...metadata, ...target }
}

function relationRequested(relations: readonly string[], fieldName: string): boolean {
  return relations.some(path => path === fieldName || path.startsWith(`${fieldName}.`))
}

function nestedRelationPaths(relations: readonly string[], fieldName: string): readonly string[] {
  const prefix = `${fieldName}.`
  return relations.flatMap(path => path.startsWith(prefix) ? [path.slice(prefix.length)] : [])
}
