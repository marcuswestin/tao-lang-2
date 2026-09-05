import Formatter from '@formatter'
import { AST, Parser } from '@parser'
import { Errors } from '@shared'
import { studioGeneratedSourceHeader } from './StudioGeneratedSources'
import type { StudioFixtureValue } from './StudioProtocol'

export type StudioSharedFixtureEntityImport = Readonly<{
  collection: string
  entity: string
  source: string
}>

export type StudioSharedFixturePromotion = Readonly<{
  entity: string
  fields: Readonly<Record<string, StudioFixtureValue>>
  name: string
}>

export type StudioSharedFixtureHandle = Readonly<{
  handle: string
  kind: 'fixture-reference'
}>

export type StudioSharedFixtureResult = Readonly<{
  fixture: 'Sketches'
  handles: readonly StudioSharedFixtureHandle[]
  source: string
}>

export type StudioSharedFixtureRequest = Readonly<{
  imports: readonly StudioSharedFixtureEntityImport[]
  promotions: readonly StudioSharedFixturePromotion[]
  source?: string
}>

/** Builds or extends the canonical Studio-owned shared fixture without performing filesystem writes. */
export const StudioSharedFixtureSource = {
  async promote(request: StudioSharedFixtureRequest): Promise<StudioSharedFixtureResult> {
    const imports = canonicalImports(request.imports)
    const canonical = canonicalPromotions(request.promotions, imports)
    let promotions: readonly StudioSharedFixturePromotion[]
    let source: string

    if (request.source === undefined) {
      promotions = orderPromotions(canonical, new Set())
      source = initialSource(imports, promotions)
    } else {
      source = request.source
      let document = await parseSource(source)
      const fixture = requireSketchesFixture(document)
      promotions = orderPromotions(canonical, new Set(fixture.block.entries.map(entry => entry.name)))
      source = await addMissingImports(source, document, imports)
      document = await parseSource(source)
      source = await addMissingPromotions(source, requireSketchesFixture(document), promotions)
    }

    source = await Formatter.formatCode(source)
    requireSketchesFixture(await parseSource(source))
    return Object.freeze({
      fixture: 'Sketches',
      handles: Object.freeze(promotions.map(row => Object.freeze({ handle: row.name, kind: 'fixture-reference' }))),
      source,
    })
  },
} as const

function canonicalImports(
  imports: readonly StudioSharedFixtureEntityImport[],
): readonly StudioSharedFixtureEntityImport[] {
  const byCollection = new Map<string, StudioSharedFixtureEntityImport>()
  for (const entry of imports) {
    requireIdentifier(entry.collection, 'entity collection')
    requireIdentifier(entry.entity, 'entity')
    if (!/^(?:\.\.?(?:\/|$))/.test(entry.source) || /[\r\n]/.test(entry.source)) {
      throw new Errors.UserInputError(`Studio shared fixture import must be project-relative: ${entry.source}`)
    }
    const previous = byCollection.get(entry.collection)
    if (previous !== undefined && (previous.entity !== entry.entity || previous.source !== entry.source)) {
      throw new Errors.UserInputError(`Studio shared fixture import conflicts for ${entry.collection}.`)
    }
    byCollection.set(entry.collection, entry)
  }
  return [...byCollection.values()].toSorted((left, right) =>
    left.source.localeCompare(right.source) || left.collection.localeCompare(right.collection)
  )
}

function canonicalPromotions(
  promotions: readonly StudioSharedFixturePromotion[],
  imports: readonly StudioSharedFixtureEntityImport[],
): readonly StudioSharedFixturePromotion[] {
  const importedEntities = new Set(imports.map(entry => entry.entity))
  const byName = new Map<string, StudioSharedFixturePromotion>()
  for (const promotion of promotions) {
    requireIdentifier(promotion.name, 'fixture row')
    requireIdentifier(promotion.entity, 'fixture row entity')
    if (!importedEntities.has(promotion.entity)) {
      throw new Errors.UserInputError(`Studio shared fixture has no import metadata for ${promotion.entity}.`)
    }
    const canonical = {
      ...promotion,
      fields: Object.fromEntries(
        Object.entries(promotion.fields).toSorted(([left], [right]) => left.localeCompare(right)),
      ),
    }
    for (const [field, value] of Object.entries(canonical.fields)) {
      requireIdentifier(field, 'fixture field')
      requireFixtureValue(value)
    }
    const previous = byName.get(canonical.name)
    if (previous !== undefined && !samePromotion(previous, canonical)) {
      throw new Errors.UserInputError(`Studio fixture row already has different content: ${canonical.name}`)
    }
    byName.set(canonical.name, canonical)
  }
  return [...byName.values()].toSorted((left, right) => left.name.localeCompare(right.name))
}

/** Orders new fixture rows after every promoted row they reference and rejects invalid dependency graphs. */
function orderPromotions(
  promotions: readonly StudioSharedFixturePromotion[],
  existingHandles: ReadonlySet<string>,
): readonly StudioSharedFixturePromotion[] {
  const byName = new Map(promotions.map(promotion => [promotion.name, promotion]))
  const availableHandles = new Set([...existingHandles, ...byName.keys()])
  for (const promotion of promotions) {
    for (const dependency of promotionDependencies(promotion)) {
      if (!availableHandles.has(dependency)) {
        throw new Errors.UserInputError(
          `Studio fixture row ${promotion.name} references an unknown fixture handle: ${dependency}`,
        )
      }
    }
  }

  const pending = new Map(
    promotions
      .filter(promotion => !existingHandles.has(promotion.name))
      .map(promotion => [
        promotion.name,
        new Set(promotionDependencies(promotion).filter(dependency => !existingHandles.has(dependency))),
      ]),
  )
  const ordered: StudioSharedFixturePromotion[] = []
  while (pending.size > 0) {
    const ready = [...pending.entries()]
      .filter(([, dependencies]) => [...dependencies].every(dependency => !pending.has(dependency)))
      .map(([name]) => name)
      .toSorted()
    if (ready.length === 0) {
      throw new Errors.UserInputError(
        `Studio fixture row dependencies form a cycle: ${[...pending.keys()].toSorted().join(', ')}`,
      )
    }
    for (const name of ready) {
      ordered.push(byName.get(name)!)
      pending.delete(name)
    }
  }

  return [
    ...promotions.filter(promotion => existingHandles.has(promotion.name)),
    ...ordered,
  ]
}

function promotionDependencies(promotion: StudioSharedFixturePromotion): string[] {
  return Object.values(promotion.fields)
    .filter((value): value is StudioSharedFixtureHandle =>
      typeof value === 'object' && value.kind === 'fixture-reference'
    )
    .map(value => value.handle)
}

function initialSource(
  imports: readonly StudioSharedFixtureEntityImport[],
  promotions: readonly StudioSharedFixturePromotion[],
): string {
  const uses = imports.map(entry => `use ${entry.collection} from ${entry.source}`).join('\n')
  const rows = promotions.map(promotionSource).join('\n')
  return `${studioGeneratedSourceHeader}\n\n${uses}${uses === '' ? '' : '\n\n'}public fixture Sketches {\n${rows}\n}\n`
}

async function addMissingImports(
  source: string,
  document: AST.Document,
  imports: readonly StudioSharedFixtureEntityImport[],
): Promise<string> {
  const uses = document.parseResult.value.statements.filter(AST.isUseStatement)
  const missing: StudioSharedFixtureEntityImport[] = []
  for (const entry of imports) {
    const matchingName = uses.filter(use =>
      use.importedDeclarations.some(declaration => declaration.$refText === entry.collection)
    )
    if (matchingName.some(use => use.importPath !== entry.source)) {
      throw new Errors.UserInputError(`Studio shared fixture import conflicts for ${entry.collection}.`)
    }
    if (matchingName.length === 0) {
      missing.push(entry)
    }
  }
  if (missing.length === 0) {
    return source
  }
  const offset = document.parseResult.value.statements[0]?.$cstNode?.offset ?? source.length
  const insertion = `${missing.map(entry => `use ${entry.collection} from ${entry.source}`).join('\n')}\n\n`
  return await Formatter.formatCode(`${source.slice(0, offset)}${insertion}${source.slice(offset)}`)
}

async function addMissingPromotions(
  source: string,
  fixture: AST.FixtureDeclaration,
  promotions: readonly StudioSharedFixturePromotion[],
): Promise<string> {
  const additions: StudioSharedFixturePromotion[] = []
  for (const promotion of promotions) {
    const existing = fixture.block.entries.find(entry => entry.name === promotion.name)
    if (existing === undefined) {
      additions.push(promotion)
      continue
    }
    if (!AST.isFixtureCreateBinding(existing) || !sameExistingPromotion(existing, promotion)) {
      throw new Errors.UserInputError(`Studio fixture row already has different content: ${promotion.name}`)
    }
  }
  if (additions.length === 0) {
    return source
  }
  const block = fixture.block.$cstNode
  if (block === undefined) {
    throw new Errors.UserInputError('Studio fixture Sketches has no editable source range.')
  }
  const offset = block.end - 1
  const insertion = `${additions.map(promotionSource).join('\n')}\n`
  return await Formatter.formatCode(`${source.slice(0, offset)}${insertion}${source.slice(offset)}`)
}

function sameExistingPromotion(existing: AST.FixtureCreateBinding, promotion: StudioSharedFixturePromotion): boolean {
  if (
    existing.entity.$refText !== promotion.entity
    || existing.through !== undefined
    || existing.account !== undefined
  ) {
    return false
  }
  const fields = Object.fromEntries(existing.block.fields.map(field => [field.name, fixtureValue(field.value)]))
  return sameFields(fields, promotion.fields)
}

function samePromotion(left: StudioSharedFixturePromotion, right: StudioSharedFixturePromotion): boolean {
  return left.entity === right.entity && sameFields(left.fields, right.fields)
}

function sameFields(
  left: Readonly<Record<string, StudioFixtureValue>>,
  right: Readonly<Record<string, StudioFixtureValue>>,
): boolean {
  const normalize = (fields: Readonly<Record<string, StudioFixtureValue>>): string =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(fields)
          .toSorted(([leftName], [rightName]) => leftName.localeCompare(rightName))
          .map(([name, value]) => [name, comparableFixtureValue(value)]),
      ),
    )
  return normalize(left) === normalize(right)
}

// Tao's current value converter round-trips named escapes but retains unicode escape digits
// without their slash. Normalize promoted strings to the same parsed representation.
function comparableFixtureValue(value: StudioFixtureValue): StudioFixtureValue {
  if (typeof value !== 'string') {
    return value
  }
  let comparable = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    const codeUnit = value.charCodeAt(index)
    const namedEscape = ['\b', '\t', '\n', '\f', '\r'].includes(character)
    comparable += codeUnit <= 0x1f && !namedEscape || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)
      ? `u${codeUnit.toString(16).padStart(4, '0')}`
      : character
  }
  return comparable
}

function fixtureValue(value: AST.FixtureValue): StudioFixtureValue {
  if (AST.isStringLiteral(value) || AST.isNumberLiteral(value)) {
    return value.value
  }
  if (AST.isBooleanLiteral(value)) {
    return value.value === 'true'
  }
  if (AST.isNowExpression(value)) {
    return { kind: 'now' }
  }
  return { handle: value.target.$refText, kind: 'fixture-reference' }
}

function promotionSource(promotion: StudioSharedFixturePromotion): string {
  const fields = Object.entries(promotion.fields)
    .map(([name, value]) => `${name}: ${fixtureValueSource(value)}`)
    .join(', ')
  return `${promotion.name} = create ${promotion.entity} { ${fields} }`
}

function fixtureValueSource(value: StudioFixtureValue): string {
  if (typeof value === 'string') {
    return taoStringLiteral(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return value.kind === 'now' ? 'now' : value.handle
}

function requireFixtureValue(value: StudioFixtureValue): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Errors.UserInputError('Studio fixture numbers must be finite.')
  }
  if (typeof value === 'object' && value.kind === 'fixture-reference') {
    requireIdentifier(value.handle, 'fixture reference')
  }
}

function taoStringLiteral(value: string): string {
  let source = '"'
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    const escaped = taoStringEscapes[character]
    if (escaped !== undefined) {
      source += escaped
      continue
    }
    const codeUnit = value.charCodeAt(index)
    source += codeUnit <= 0x1f || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)
      ? `\\u${codeUnit.toString(16).padStart(4, '0')}`
      : character
  }
  return `${source}"`
}

const taoStringEscapes: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
}

async function parseSource(source: string): Promise<AST.Document> {
  const document = (await Parser.parseCode(source, { validation: false })).entry.document
  const error = document.parseResult.lexerErrors[0]?.message ?? document.parseResult.parserErrors[0]?.message
  if (error !== undefined) {
    throw new Errors.UserInputError(`Studio shared fixture source is invalid Tao: ${error}`)
  }
  return document
}

function requireSketchesFixture(document: AST.Document): AST.FixtureDeclaration {
  const fixtures = document.parseResult.value.statements
    .filter(AST.isFixtureDeclaration)
    .filter(fixture => fixture.name === 'Sketches')
  if (fixtures.length !== 1 || fixtures[0]!.visibility !== 'public') {
    throw new Errors.UserInputError('Studio shared fixture source must declare exactly one public fixture Sketches.')
  }
  return fixtures[0]!
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Errors.UserInputError(`Studio shared ${label} name is invalid: ${value}`)
  }
}
