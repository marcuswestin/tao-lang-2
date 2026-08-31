import { Describe, Expect, Test } from '@shared/test'
import {
  compileGenerationSchema,
  type EntityGenerationDeclaration,
  type GenerationDeclaration,
} from '../generation-src/generation'

Describe('entity generation schema compiler', () => {
  Test('compiles case declarations and case fields as closed choices', () => {
    const course = compileGenerationSchema({
      kind: 'case',
      name: 'Course',
      cases: ['Starter', 'Main', 'Dessert'],
    })
    Expect(course.schema).toMatchObject({
      title: 'Course',
      type: 'string',
      enum: ['Starter', 'Main', 'Dessert'],
    })

    const recipe = compileGenerationSchema(entity([
      field('Course', { kind: 'case', name: 'Course', cases: ['Starter', 'Main', 'Dessert'] }),
    ]))
    Expect(recipe.schema.properties?.['Course']).toEqual({
      description: undefined,
      type: 'string',
      enum: ['Starter', 'Main', 'Dessert'],
    })
  })

  Test('preserves scalar defaults, treats now as provided, and carries required copy into guidance', () => {
    const compiled = compileGenerationSchema(entity([
      field('Title', { kind: 'scalar', scalar: 'text' }, {
        guidance: 'Give the recipe a specific, appetizing title.',
      }),
      field('Servings', { kind: 'scalar', scalar: 'number' }, { defaultValue: 4 }),
      field('Created', { kind: 'scalar', scalar: 'time' }, { defaultValue: { kind: 'now' } }),
    ]))

    Expect(compiled.schema.required).toEqual(['Title'])
    Expect(compiled.schema.properties?.['Servings']?.default).toBe(4)
    Expect(compiled.schema.properties?.['Created']).toMatchObject({ type: 'string' })
    Expect(compiled.schema.properties?.['Created']?.default).toBeUndefined()
    Expect(compiled.schema.properties?.['Title']?.description).toBe(
      'Give the recipe a specific, appetizing title.',
    )
    Expect(compiled.guide).toContain(
      'Title: Give the recipe a specific, appetizing title.',
    )
  })

  Test('always excludes secrets and includes relations only by explicit field name', () => {
    const document = entity([
      field('Title', { kind: 'scalar', scalar: 'text' }),
      field('Workspace', {
        kind: 'relation',
        entity: 'Workspace',
        inverse: false,
      }),
      field('PrivateNotes', { kind: 'scalar', scalar: 'text' }, { secret: true }),
      field('SecretWorkspace', {
        kind: 'relation',
        entity: 'Workspace',
        inverse: false,
      }, { secret: true }),
    ], 'Document')
    const workspace = entity([
      field('Name', { kind: 'scalar', scalar: 'text' }),
    ], 'Workspace')
    const declarations: GenerationDeclaration[] = [document, workspace]

    const implicit = compileGenerationSchema(document, { declarations })
    Expect(implicit.includedFields).toEqual(['Title'])
    Expect(implicit.schema.properties).toEqual({
      Title: { description: undefined, type: 'string' },
    })

    const explicit = compileGenerationSchema(document, {
      declarations,
      relations: ['Workspace', 'SecretWorkspace'],
    })
    Expect(explicit.includedFields).toEqual(['Title', 'Workspace'])
    Expect(explicit.schema.properties?.['Workspace']).toMatchObject({
      title: 'Workspace',
      type: 'object',
      properties: { Name: { type: 'string' } },
    })
    Expect(explicit.schema.properties?.['SecretWorkspace']).toBeUndefined()
    Expect(explicit.schema.properties?.['PrivateNotes']).toBeUndefined()
  })

  Test('derives inverse relation arrays while direct relations remain single objects', () => {
    const workspace = entity([
      field('Documents', {
        kind: 'relation',
        entity: 'Document',
        inverse: true,
      }),
    ], 'Workspace')
    const document = entity([
      field('Workspace', {
        kind: 'relation',
        entity: 'Workspace',
        inverse: false,
      }),
      field('Title', { kind: 'scalar', scalar: 'text' }),
    ], 'Document')
    const declarations = [workspace, document]

    const direct = compileGenerationSchema(document, {
      declarations,
      relations: ['Workspace'],
    })
    Expect(direct.schema.properties?.['Workspace']?.type).toBe('object')

    const inverse = compileGenerationSchema(workspace, {
      declarations,
      relations: ['Documents'],
    })
    Expect(inverse.schema.properties?.['Documents']?.type).toBe('array')
    Expect(inverse.schema.properties?.['Documents']?.items?.title).toBe('Document')
  })

  Test('includes nested relations only by an explicit path', () => {
    const workspace = entity([
      field('Parent', {
        kind: 'relation',
        entity: 'Workspace',
        inverse: false,
      }),
      field('Name', { kind: 'scalar', scalar: 'text' }),
    ], 'Workspace')

    const oneLevel = compileGenerationSchema(workspace, {
      declarations: [workspace],
      relations: ['Parent'],
    })
    Expect(oneLevel.schema.properties?.['Parent']?.properties?.['Parent']).toBeUndefined()

    const twoLevels = compileGenerationSchema(workspace, {
      declarations: [workspace],
      relations: ['Parent.Parent'],
    })
    Expect(twoLevels.schema.properties?.['Parent']?.properties?.['Parent']?.type).toBe('object')
    Expect(twoLevels.schema.properties?.['Parent']?.properties?.['Parent']?.properties?.['Parent']).toBeUndefined()
  })
})

function entity(
  fields: EntityGenerationDeclaration['fields'],
  name = 'Recipe',
): EntityGenerationDeclaration {
  return { kind: 'entity', name, collection: `${name}s`, fields }
}

function field(
  name: string,
  type: EntityGenerationDeclaration['fields'][number]['type'],
  options: Partial<Omit<EntityGenerationDeclaration['fields'][number], 'name' | 'type'>> = {},
): EntityGenerationDeclaration['fields'][number] {
  return {
    name,
    type,
    optional: options.optional ?? false,
    secret: options.secret ?? false,
    ...(options.defaultValue === undefined ? {} : { defaultValue: options.defaultValue }),
    ...(options.guidance === undefined ? {} : { guidance: options.guidance }),
  }
}
