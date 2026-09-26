import { Packages, Type } from '@ast-utils'
import { RuntimeToolchainPaths } from '@expo-host'
import { AST, Parser, URI } from '@parser'
import { CLI, Errors, FS, Json, Repo } from '@shared'
import { shipInputHash } from './ship-model'

type CommandRunner = typeof CLI.run

/** runtimeFingerprint asks Expo to hash the iOS native closure, excluding copy-only Tao output. */
export async function runtimeFingerprint(runtimeRoot: string, runner: CommandRunner = CLI.run): Promise<string> {
  // ship.json contains the current build number, commit, and marketing version. Those values do not
  // change native compatibility and must not make a later copy-only update look incompatible.
  await FS.remove(FS.resolvePath('_gen_tao-app/ship.json', runtimeRoot))
  const command = RuntimeToolchainPaths.nodeScriptCommand(runtimeRoot, 'fingerprint', [
    'fingerprint:generate',
    '--platform',
    'ios',
  ])
  const result = await runner(command.command, {
    args: command.args,
    cwd: runtimeRoot,
    env: command.env,
  })
  if (result.error || result.exitCode !== 0) {
    Errors.throwHostEnvironment(`Expo could not compute the iOS runtime fingerprint: ${result.stderr.trim()}`)
  }
  let body: unknown
  try {
    body = JSON.parse(result.stdout)
  } catch (error) {
    Errors.throwHostEnvironment('Expo returned an invalid runtime fingerprint response.', { cause: error })
  }
  if (!Json.isRecord(body) || typeof body['hash'] !== 'string' || body['hash'].length === 0) {
    Errors.throwHostEnvironment('Expo returned a runtime fingerprint response without a hash.')
  }
  return body['hash']
}

/** dataSchemaFingerprint hashes only the storage semantics of authored entity-data declarations. */
export async function dataSchemaFingerprint(projectRoot: string): Promise<string> {
  const schemas: ReturnType<typeof canonicalEntitySchema>[] = []
  const paths = (await Repo.filesUnder(projectRoot, { extensions: ['.tao'] }))
    .filter(path => !path.endsWith('.test.tao'))
  const packages = Packages.createResolver(await Packages.createContext(projectRoot))
  const parsedFiles = await Parser.parseEntries(Parser.createContext({ packages }), paths.map(path => URI.file(path)), {
    validation: false,
  })
  for (const parsed of parsedFiles) {
    for (const file of parsed.files) {
      const syntax = file.document.parseResult
      if (syntax.lexerErrors.length > 0 || syntax.parserErrors.length > 0) {
        Errors.throwUserInput(`Cannot fingerprint data schema: '${file.path}' contains invalid Tao syntax.`)
      }
    }
    for (const entity of parsed.entry.ast.statements.filter(AST.isEntityDataDeclaration)) {
      schemas.push(canonicalEntitySchema(entity))
    }
  }
  return shipInputHash(schemas.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
}

function canonicalEntitySchema(entity: AST.EntityDataDeclaration) {
  const fields = entity.block.entries.filter(AST.isEntityDataField).map(field => ({
    boolean: field.boolean,
    name: field.name,
    negativeName: field.negativeName ?? null,
    optional: field.optional,
    primitive: field.primitive ?? null,
    storedValueType: canonicalStoredValueType(field),
    typeName: field.typeName ?? null,
    traits: (field.traits?.traits ?? []).map(canonicalTrait).toSorted(compareCanonicalValues),
  })).toSorted((left, right) => left.name.localeCompare(right.name))
  const indexes = entity.block.entries.filter(AST.isDataIndex)
    .map(index => index.fieldName)
    .toSorted((left, right) => left.localeCompare(right))
  const orders = entity.block.entries.filter(AST.isDataDefaultOrder)
    .map(order => ({ direction: order.direction ?? 'asc', fieldName: order.fieldName }))
    .toSorted(compareCanonicalValues)
  // A composite constraint compares the same tuple of values in every row. Reordering its
  // components or independent constraints does not change which rows violate uniqueness.
  const unique = entity.block.entries.filter(AST.isDataUnique)
    .map(constraint => constraint.fieldNames.toSorted((left, right) => left.localeCompare(right)))
    .toSorted(compareCanonicalValues)
  return {
    fields,
    indexes,
    localOnly: entity.block.entries.some(AST.isDataLocalOnly),
    name: entity.name,
    orders,
    singularName: entity.singularName,
    unique,
    visibility: entity.visibility ?? null,
  }
}

function canonicalStoredValueType(field: AST.EntityDataField) {
  const type = Type.dataFieldType(field)
  if (type.kind === 'enum') {
    return { kind: 'enum', cases: AST.caseSetCasesOf(type.declaration).map(AST.caseSetCaseName).toSorted() }
  }
  if (type.kind === 'primitive') {
    return { kind: type.primitive }
  }
  return null
}

function canonicalTrait(trait: AST.Trait): Readonly<Record<string, unknown>> {
  if (trait.defaultValue !== undefined) {
    return { kind: 'default', value: canonicalDefaultValue(trait.defaultValue) }
  }
  if (trait.defaultCase !== undefined) {
    return { kind: 'default-case', value: trait.defaultCase }
  }
  if (trait.relationName !== undefined) {
    return { kind: 'relation', value: trait.relationName }
  }
  if (trait.reference) {
    return { kind: 'reference', value: trait.referenceName ?? null }
  }
  if (trait.sentence !== undefined) {
    return { kind: 'required', value: trait.sentence }
  }
  if (trait.touchOnChange) {
    return { kind: 'touch-on-change' }
  }
  if (trait.owned) {
    return { kind: 'owned' }
  }
  if (trait.ordered) {
    return { kind: 'ordered' }
  }
  if (trait.unique) {
    return { kind: 'unique' }
  }
  if (trait.search) {
    return { kind: 'search' }
  }
  if (trait.device) {
    return { kind: 'device' }
  }
  if (trait.word !== undefined) {
    return { kind: 'word', value: trait.word }
  }
  Errors.throwUnexpected('Expected: every entity-data trait has canonical storage semantics.')
}

function canonicalDefaultValue(value: AST.BooleanLiteral | AST.NowExpression | AST.NumberLiteral | AST.StringLiteral) {
  if (AST.isNowExpression(value)) {
    return { kind: 'now' }
  }
  if (AST.isBooleanLiteral(value)) {
    return { kind: 'boolean', value: value.value === 'true' }
  }
  if (AST.isNumberLiteral(value)) {
    return { kind: 'number', value: value.value }
  }
  if (AST.isStringLiteral(value)) {
    return { kind: 'string', value: value.value }
  }
  Errors.throwUnexpected('Expected: an entity-data default is a supported literal.')
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}
