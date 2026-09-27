import type { EntityGenerationDeclaration } from '@generation'
import { AST, Parser } from '@parser'
import { Assert, FS, Json } from '@shared'
import type { StudioFeedBrowser } from './StudioFeedBrowser'
import { StudioFeedInventory, type StudioFeedItemId } from './StudioFeedInventory'
import type { StudioFeedActionRequest } from './StudioFeedProtocol'
import { StudioFeedSource } from './StudioFeedSource'
import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'
import type { StudioFixtureValue, StudioJsonObject } from './StudioProtocol'
import type { StudioSharedFixturePromotion } from './StudioSharedFixtureSource'
import type { StudioSketchCatalogSnapshot, StudioSketchRect } from './StudioSketchCatalog'

type Browser = ReturnType<typeof StudioFeedBrowser.build>
type DraftAction = Extract<StudioFeedActionRequest, { kind: 'bind' | 'select' }>
type Promotion = StudioSharedFixturePromotion

/** Resolves only server-issued rows and prepares immutable sources and catalog changes without writing. */
export const StudioFeedDraft = {
  async prepare(
    input: Readonly<{
      browser: Browser
      catalog: StudioSketchCatalogSnapshot
      manifest: StudioPreviewManifestV2
      projectRoot: string
      entryPath: string
      scenarioName?: string
      prepareSource?: typeof StudioFeedSource.prepare
      readSource: (path: string) => Promise<string | undefined>
      request: DraftAction
    }>,
  ) {
    const { browser, catalog, manifest, request } = input
    Assert.input(catalog.revision === request.catalogRevision, 'Feed sketch catalog changed; browse again.')
    const row = browser.inventory.entities.flatMap(entity => entity.sources.flatMap(source => source.rows))
      .find(candidate => candidate.id === request.rowId)
    const promotion = browser.promotions.get(request.rowId as StudioFeedItemId)
    Assert.input(row !== undefined && promotion !== undefined, 'Feed row is no longer available; browse again.')
    const sketch = catalog.sketches.find(candidate => candidate.id === request.sketchId)
    Assert.input(sketch !== undefined, 'Feed sketch no longer exists.')
    const declarations = manifest.generationDeclarations.filter(
      (declaration): declaration is EntityGenerationDeclaration => declaration.kind === 'entity',
    )
    const entity = declarations.find(declaration => declaration.name === promotion.entity)
    Assert.input(entity !== undefined, 'Feed entity is no longer declared.')
    const viewPath = FS.resolvePath(`@/studio/${sketch.view}.tao`, input.projectRoot)
    const fixturePath = FS.resolvePath('@/studio/Sketches.tao', input.projectRoot)
    const [viewSource, fixtureSource] = await Promise.all([input.readSource(viewPath), input.readSource(fixturePath)])
    Assert.input(viewSource !== undefined, 'Feed sketch source no longer exists.')
    const closure = dependencyClosure(manifest, row.source.fixtureId, promotion, declarations)
    const existing = await existingPromotions(fixtureSource)
    const renamed = renamePromotions(closure, existing, row.source.fixtureId ?? row.source.kind)
    const selectedHandle = renamed.names.get(promotion.name)!
    let updatedSketch = sketch
    if (request.kind === 'bind') {
      validateBinding(entity, declarations, request.path, request.presentation)
      const rect = [...sketch.rects, ...sketch.snapped.map(item => item.rect)]
        .find(candidate => candidate.id === request.rectId)
      Assert.input(rect !== undefined, 'Feed rectangle no longer exists.')
      const bind = (candidate: StudioSketchRect): StudioSketchRect =>
        candidate.id === request.rectId
          ? {
            ...candidate,
            fieldBinding: {
              parameter: entity.name,
              path: request.path.join('.'),
              presentation: { kind: request.presentation },
            },
          }
          : candidate
      updatedSketch = {
        ...sketch,
        rects: sketch.rects.map(bind),
        snapped: sketch.snapped.map(item => ({ ...item, rect: bind(item.rect) })),
      }
    }
    const bindings = [...updatedSketch.rects, ...updatedSketch.snapped.map(item => item.rect)].flatMap(rect => {
      const binding = rect.fieldBinding
      if (binding === undefined || binding.parameter !== entity.name) {
        return []
      }
      const path = binding.path.split('.')
      validateBinding(entity, declarations, path, binding.presentation.kind)
      return [{ path, presentation: binding.presentation.kind, rectId: rect.id }]
    })
    const scenario = request.cellId !== undefined
      ? manifest.scenarios.find(candidate =>
        candidate.scenarioId === manifest.cells.find(cell => cell.cellId === request.cellId)?.scenarioId
      )
      : undefined
    Assert.input(request.cellId === undefined || scenario !== undefined, 'Feed preview cell no longer exists.')
    const prepared = await (input.prepareSource ?? StudioFeedSource.prepare)({
      bindings,
      entity: entity.name,
      entryPath: FS.resolvePath(input.entryPath, input.projectRoot),
      ...(fixtureSource === undefined ? {} : { fixtureSource }),
      projectRoot: input.projectRoot,
      promotions: renamed.promotions,
      ...(input.scenarioName !== undefined
        ? { scenarioName: input.scenarioName }
        : scenario === undefined
        ? {}
        : { scenarioName: scenario.scenarioId.split('.').at(-1)! }),
      selectedHandle,
      sketch: updatedSketch,
      viewSource,
    })
    const nextCatalog = Object.freeze({
      ...catalog,
      sketches: Object.freeze(
        catalog.sketches.map(candidate => candidate.id === sketch.id ? updatedSketch : candidate),
      ),
    })
    return Object.freeze({
      catalog: nextCatalog,
      entity: entity.name,
      rowId: row.id,
      selectedHandle,
      selection: Object.freeze({
        path: viewPath,
        range: Object.freeze({
          end: Math.max(0, prepared.sources[viewPath]!.indexOf(`view ${sketch.view}`)) + `view ${sketch.view}`.length,
          start: Math.max(0, prepared.sources[viewPath]!.indexOf(`view ${sketch.view}`)),
        }),
      }),
      sketchId: sketch.id,
      sources: Object.freeze({ ...prepared.sources }),
    })
  },
} as const

function validateBinding(
  entity: EntityGenerationDeclaration,
  declarations: readonly EntityGenerationDeclaration[],
  path: readonly string[],
  presentation: string,
): void {
  Assert.input(path.length > 0 && path.length <= 2, 'Feed bindings support one field or one related field.')
  let owner = entity
  for (const [index, name] of path.entries()) {
    const field = owner.fields.find(candidate => candidate.name === name && !candidate.secret)
    Assert.input(field !== undefined, 'Feed field is not available.')
    Assert.input(!field.optional, 'Feed optional fields require a fallback before binding.')
    if (index < path.length - 1) {
      Assert.input(
        field.type.kind === 'relation' && !field.type.inverse,
        'Feed nested fields require a single related entity.',
      )
      const targetName = field.type.entity
      const target = declarations.find(candidate => candidate.name === targetName)
      Assert.input(target !== undefined, 'Feed related entity is not available.')
      owner = target
      continue
    }
    Assert.input(field.type.kind !== 'relation', 'Feed collections require a loop proposal.')
    Assert.input(presentation === 'text' || presentation === 'image', 'Feed presentation is not supported.')
    Assert.input(
      presentation !== 'image' || field.type.kind === 'scalar' && field.type.scalar === 'text',
      'Feed images require a text field.',
    )
  }
}

function dependencyClosure(
  manifest: StudioPreviewManifestV2,
  fixtureId: string | undefined,
  selected: Readonly<{ entity: string; fields: StudioJsonObject; name: string }>,
  declarations: readonly EntityGenerationDeclaration[],
): readonly Promotion[] {
  const fixture = manifest.fixtures.find(candidate => candidate.fixtureId === fixtureId)
  const rows = fixture?.plan['creates']
  const originals = new Map<string, Readonly<{ entity: string; fields: StudioJsonObject; name: string }>>()
  const unsupported = new Set<string>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (
      Json.isRecord(row) && typeof row['name'] === 'string' && typeof row['entity'] === 'string'
      && Json.isRecord(row['fields'])
    ) {
      if (row['account'] !== undefined || row['through'] !== undefined) {
        unsupported.add(row['name'])
      }
      originals.set(row['name'], {
        entity: row['entity'],
        fields: row['fields'] as StudioJsonObject,
        name: row['name'],
      })
    }
  }
  originals.set(selected.name, selected)
  const visited = new Set<string>()
  const active = new Set<string>()
  const result: Promotion[] = []
  const visit = (name: string, expectedEntity?: string): void => {
    Assert.input(!active.has(name), 'Feed fixture relations contain a cycle.')
    Assert.input(!unsupported.has(name), 'Feed cannot promote account-owned or action-created fixture rows.')
    const row = originals.get(name)
    Assert.input(row !== undefined, 'Feed relation refers to an unavailable fixture row.')
    Assert.input(
      expectedEntity === undefined || row.entity === expectedEntity,
      'Feed relation has the wrong entity type.',
    )
    if (visited.has(name)) {
      return
    }
    Assert.input(visited.size + active.size < 250, 'Feed relation promotion exceeds 250 rows.')
    active.add(name)
    const declaration = declarations.find(candidate => candidate.name === row.entity)
    Assert.input(declaration !== undefined, 'Feed related entity is no longer declared.')
    Assert.input(
      !declaration.fields.some(field => field.secret && !field.optional && field.defaultValue === undefined),
      'Feed cannot promote a row requiring a private value.',
    )
    const checked = StudioFeedInventory.build(declaration, [{ entity: row.entity, kind: 'library', rows: [row] }])
      .items[0]!
    const fields: Record<string, StudioFixtureValue> = {}
    for (const field of declaration.fields.filter(candidate => !candidate.secret)) {
      const value = checked.fields[field.name]
      if (value === undefined) {
        Assert.input(
          field.optional || field.defaultValue !== undefined || field.type.kind === 'relation' && field.type.inverse,
          'Feed row is missing a required field.',
        )
        continue
      }
      if (field.type.kind === 'relation') {
        Assert.input(
          !field.type.inverse && Json.isRecord(value) && value['kind'] === 'fixture-reference'
            && typeof value['handle'] === 'string',
          'Feed relation needs a fixture reference before promotion.',
        )
        visit(value['handle'], field.type.entity)
      }
      Assert.input(
        field.type.kind !== 'scalar' || field.type.scalar !== 'time' || Json.isRecord(value) && value['kind'] === 'now',
        'Feed time promotion requires an executable now value.',
      )
      fields[field.name] = value as StudioFixtureValue
    }
    active.delete(name)
    visited.add(name)
    result.push({ entity: row.entity, fields, name })
  }
  visit(selected.name)
  // Discover inverse members only after creation dependencies have completed. A child
  // referring to its already-promoted parent is not a cyclic fixture creation graph.
  for (let index = 0; index < result.length; index++) {
    const parent = result[index]!
    const declaration = declarations.find(candidate => candidate.name === parent.entity)!
    const targets = declaration.fields.flatMap(field =>
      !field.secret && field.type.kind === 'relation' && field.type.inverse ? [field.type.entity] : []
    )
    for (const child of originals.values()) {
      if (visited.has(child.name) || !targets.includes(child.entity)) {
        continue
      }
      const childDeclaration = declarations.find(candidate => candidate.name === child.entity)
      const related = childDeclaration?.fields.some(field => {
        const value = child.fields[field.name]
        return !field.secret && field.type.kind === 'relation' && !field.type.inverse
          && field.type.entity === parent.entity && Json.isRecord(value)
          && value['kind'] === 'fixture-reference' && value['handle'] === parent.name
      })
      if (related) {
        visit(child.name, child.entity)
      }
    }
  }
  return result
}

async function existingPromotions(source: string | undefined): Promise<ReadonlyMap<string, Promotion | undefined>> {
  if (source === undefined) {
    return new Map()
  }
  const document = (await Parser.parseCode(source, { validation: false })).entry.document
  Assert.input(
    document.parseResult.lexerErrors.length === 0 && document.parseResult.parserErrors.length === 0,
    'Feed shared fixture source is invalid.',
  )
  const fixture = document.parseResult.value.statements.filter(AST.isFixtureDeclaration).find(candidate =>
    candidate.name === 'Sketches'
  )
  Assert.input(fixture !== undefined, 'Feed shared fixture is missing Sketches.')
  return new Map(
    AST.fixtureValueDeclarations(fixture).map(row => [
      row.name,
      AST.isFixtureCreateBinding(row)
        ? {
          entity: row.entity.$refText,
          fields: Object.fromEntries(row.block.fields.map(field => [field.name, fixtureValue(field.value)])),
          name: row.name,
        }
        : undefined,
    ]),
  )
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

function renamePromotions(
  rows: readonly Promotion[],
  existing: ReadonlyMap<string, Promotion | undefined>,
  origin: string,
): Readonly<{ names: ReadonlyMap<string, string>; promotions: readonly Promotion[] }> {
  const names = new Map<string, string>()
  const occupied = new Map(existing)
  const promotions = rows.map(row => {
    const fields = Object.fromEntries(
      Object.entries(row.fields).sort(([left], [right]) => left.localeCompare(right)).map((
        [name, value],
      ) => [
        name,
        typeof value === 'object' && value.kind === 'fixture-reference'
          ? { handle: names.get(value.handle)!, kind: 'fixture-reference' as const }
          : value,
      ]),
    )
    const base = `Feed${hash(`${origin}:${row.name}:${row.entity}:${JSON.stringify(fields)}`)}`
    let name = base
    let suffix = 2
    const candidate = () => ({ entity: row.entity, fields, name })
    while (occupied.has(name) && !samePromotion(occupied.get(name), candidate())) {
      name = `${base}_${suffix++}`
    }
    names.set(row.name, name)
    const promotion = candidate()
    occupied.set(name, promotion)
    return Object.freeze(promotion)
  })
  return { names, promotions }
}

function samePromotion(left: Promotion | undefined, right: Promotion): boolean {
  const fields = (row: Promotion) => JSON.stringify(Object.entries(row.fields).sort(([a], [b]) => a.localeCompare(b)))
  return left !== undefined && left.entity === right.entity && fields(left) === fields(right)
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  }
  return (result >>> 0).toString(36)
}
