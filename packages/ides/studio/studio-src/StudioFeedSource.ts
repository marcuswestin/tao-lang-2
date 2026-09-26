import { Packages, Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert, Errors, FS } from '@shared'
import SourceActions, { type StudioScenarioArgumentValue } from '@source-actions'
import { type StudioSharedFixturePromotion, StudioSharedFixtureSource } from './StudioSharedFixtureSource'
import type { StudioSketch } from './StudioSketchCatalog'
import { studioSourceImport } from './StudioSourceImport'

type FeedSourceRequest = Readonly<{
  bindings?: readonly Readonly<{ path: readonly string[]; presentation: 'text' | 'image'; rectId: string }>[]
  entity: string
  entryPath: string
  fixtureSource?: string
  projectRoot: string
  promotions: readonly StudioSharedFixturePromotion[]
  scenarioName?: string
  selectedHandle: string
  sketch: StudioSketch
  viewSource: string
}>

/** Prepares Feed's generated Tao sources in memory; persistence belongs to the session transaction. */
export const StudioFeedSource = {
  async prepare(request: FeedSourceRequest): Promise<{ sources: Record<string, string> }> {
    Assert.input(/^View[1-9][0-9]*$/.test(request.sketch.view), 'Feed requires a generated sketch view.')
    const viewPath = FS.resolvePath(`@/studio/${request.sketch.view}.tao`, request.projectRoot)
    const fixturePath = FS.resolvePath('@/studio/Sketches.tao', request.projectRoot)
    const sources: Record<string, string> = { [viewPath]: request.viewSource }
    if (request.fixtureSource !== undefined) {
      sources[fixturePath] = request.fixtureSource
    }
    const parse = async () => {
      const workspace = await Workspace.open(request.projectRoot, { sourceOverrides: sources })
      const results = await workspace.parseFiles([
        request.entryPath,
        viewPath,
        ...(sources[fixturePath] === undefined ? [] : [fixturePath]),
      ])
      const files = [...new Set(results.flatMap(result => result.files.map(file => file.ast)))]
      const document = files.find(file => AST.getDocument(file).uri.fsPath === viewPath)
      Assert.defined(document, 'Feed overlay contains the generated sketch view')
      return { document: AST.getDocument(document), files }
    }
    let parsed = await parse()
    const entity = requireEntity(parsed.files, request.entity)
    const entityName = entity.singularName
    const entityPath = AST.getDocument(entity).uri.fsPath
    const promotionEntities = [...new Set([request.entity, ...request.promotions.map(row => row.entity)])]
      .map(name => requireEntity(parsed.files, name))
    const packageContext = await Packages.createContext(request.projectRoot, { sourcePaths: Object.keys(sources) })
    const fixture = await StudioSharedFixtureSource.promote({
      imports: promotionEntities.map(declaration => ({
        collection: declaration.name,
        entity: declaration.singularName,
        source: requireEntityImport(packageContext, fixturePath, declaration),
      })),
      promotions: request.promotions.map(row => ({
        ...row,
        entity: requireEntity(parsed.files, row.entity).singularName,
      })),
      ...(request.fixtureSource === undefined ? {} : { source: request.fixtureSource }),
    })
    sources[fixturePath] = fixture.source
    sources[viewPath] = importFixture(parsed.document)
    parsed = await parse()
    const view = requireView(parsed.document, request.sketch.view)
    const group = requireGroup(parsed.document, view)
    const scenarios = AST.scenarioDeclarations(group)
    Assert.input(scenarios.length > 0, 'Feed requires a sketch scenario entry.')
    Assert.input(
      request.scenarioName === undefined || scenarios.some(scenario => scenario.name === request.scenarioName),
      `Feed sketch scenario no longer exists: ${request.scenarioName}`,
    )
    const parameter = AST.parametersOf(view).find(candidate => Type.parameterName(candidate) === entityName)
    if (parameter === undefined) {
      sources[viewPath] = (await SourceActions.applyStudioPatch(parsed.document, {
        entity: {
          declarationName: entity.name,
          importPath: studioSourceImport(packageContext, viewPath, entityPath),
          parameterName: entityName,
        },
        fixtureName: 'Sketches',
        kind: 'add-sketch-entity-parameter',
        scenarioArguments: scenarios.map(scenario => ({
          fixtureHandle: request.selectedHandle,
          scenarioName: scenario.name,
        })),
        scenarioGroupName: group.name,
        viewName: view.name,
      }, { files: parsed.files })).content
    } else {
      const parameterType = Type.ofParameter(parameter)
      Assert.input(
        parameterType.kind === 'entity' && parameterType.entity.name === entity.name
          && AST.getDocument(parameterType.entity).uri.fsPath === entityPath,
        `Feed sketch parameter ${entityName} does not have the selected entity type.`,
      )
      requireFixtureHandle(parsed.files, fixturePath, request.selectedHandle, entityName, entityPath)
      for (const scenario of scenarios) {
        const clause = AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause)
        Assert.input(
          clause === undefined || (clause.fixture.ref?.name === 'Sketches'
            && AST.getDocument(clause.fixture.ref).uri.fsPath === fixturePath),
          `Feed sketch scenario ${scenario.name} already uses another fixture.`,
        )
      }
      if (!group.block.entries.some(AST.isScenarioFixtureClause)) {
        const source = parsed.document.textDocument.getText()
        const offset = group.block.$cstNode!.offset + 1
        sources[viewPath] = `${source.slice(0, offset)}\nfixture Sketches\n${source.slice(offset)}`
      }
      const selected = scenarios.filter(scenario =>
        request.scenarioName === undefined || scenario.name === request.scenarioName
      ).map(scenario => scenario.name)
      for (const scenarioName of selected) {
        parsed = await parse()
        const currentGroup = requireGroup(parsed.document, requireView(parsed.document, request.sketch.view))
        const scenario = AST.scenarioDeclarations(currentGroup).find(candidate => candidate.name === scenarioName)!
        const render = AST.effectiveScenarioSubjectClause(scenario)
        Assert.input(render === undefined || AST.isScenarioRenderClause(render), 'Feed requires a render scenario.')
        const arguments_ = Object.fromEntries((render?.argumentList?.arguments ?? []).map(argument => {
          Assert.input(argument.label !== undefined, 'Feed requires named existing scenario arguments.')
          return [argument.label, scenarioValue(argument.value)]
        }))
        sources[viewPath] = (await SourceActions.applyStudioPatch(parsed.document, {
          arguments: { ...arguments_, [entityName]: { handle: request.selectedHandle, kind: 'fixture-reference' } },
          kind: 'set-scenario-arguments',
          scenarioGroupName: currentGroup.name,
          scenarioName,
        })).content
      }
    }
    for (const binding of request.bindings ?? []) {
      if (!request.sketch.snapped.some(snapped => snapped.rect.id === binding.rectId)) {
        continue
      }
      parsed = await parse()
      const view = requireView(parsed.document, request.sketch.view)
      const tag = `#studio_rect_${
        Array.from(binding.rectId, character =>
          Array.from({ length: character.length }, (_, index) =>
            character.charCodeAt(index).toString(16).padStart(4, '0'))
            .join('')).join('')
      }`
      const renders = AST.streamAllContents(view).filter(AST.isRender)
        .filter(render => AST.attachedTag(render)?.tag === tag)
      Assert.input(renders.length === 1, `Feed rectangle no longer has one source binding: ${binding.rectId}`)
      const cst = renders[0]!.$cstNode!
      const [firstField, ...remainingFields] = binding.path
      Assert.input(firstField !== undefined, 'Feed field binding requires a nonempty field path.')
      sources[viewPath] = (await SourceActions.applyStudioPatch(parsed.document, {
        fieldPath: [firstField, ...remainingFields],
        kind: 'bind-sketch-field',
        parameterName: entityName,
        presentation: { kind: binding.presentation },
        rectId: binding.rectId,
        renderId: `${viewPath}:${cst.offset}:${cst.end}`,
        viewName: request.sketch.view,
      })).content
    }
    return { sources }
  },
} as const

function requireEntityImport(
  context: Packages.Context,
  from: string,
  entity: AST.EntityDataDeclaration,
): string {
  const path = AST.getDocument(entity).uri.fsPath
  const source = studioSourceImport(context, from, path)
  const resolution = Packages.resolve(context, { fromFilePath: from, importPath: source })
  Assert.input(
    Packages.isVisible(Packages.visibilityOf(entity), resolution),
    `Feed cannot use ${entity.singularName} from ${FS.basename(path)}: its ${
      entity.visibility ?? 'file'
    } visibility does not allow imports from @/studio. Move the entity to a shared model package with workspace or public visibility.`,
  )
  return source
}

function requireEntity(files: readonly AST.TaoFile[], name: string): AST.EntityDataDeclaration {
  const declarations = files.flatMap(file => file.statements.filter(AST.isEntityDataDeclaration))
    .filter(entity => entity.name === name || entity.singularName === name)
  Assert.input(declarations.length === 1, `Feed entity is not uniquely declared: ${name}`)
  return declarations[0]!
}

function requireView(document: AST.Document, name: string): AST.ViewDeclaration {
  const views = document.parseResult.value.statements.filter(AST.isViewDeclaration).filter(view => view.name === name)
  Assert.input(views.length === 1 && views[0]!.visibility === 'public', `Feed requires one public sketch view: ${name}`)
  return views[0]!
}

function requireGroup(document: AST.Document, view: AST.ViewDeclaration): AST.ScenarioGroupDeclaration {
  const groups = document.parseResult.value.statements.filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.subject?.ref === view)
  Assert.input(groups.length === 1 && groups[0]!.name === 'sketch', 'Feed requires one owned sketch scenario group.')
  return groups[0]!
}

function importFixture(document: AST.Document): string {
  const file = document.parseResult.value
  const uses = file.statements.filter(AST.isUseStatement)
  const existing = uses.filter(use => use.importedDeclarations.some(reference => reference.$refText === 'Sketches'))
  Assert.input(
    !file.statements.some(statement => AST.isFixtureDeclaration(statement) && statement.name === 'Sketches')
      && existing.every(use =>
        use.importPath === './Sketches.tao' || use.importPath === './Sketches'
        || use.importPath === '@/studio/Sketches.tao' || use.importPath === '@/studio/Sketches'
      ),
    'Feed sketch already declares or imports another Sketches fixture.',
  )
  const source = document.textDocument.getText()
  if (existing.length > 0) {
    return source
  }
  const offset = file.statements[0]?.$cstNode?.offset ?? source.length
  return `${source.slice(0, offset)}use Sketches from ./Sketches.tao\n\n${source.slice(offset)}`
}

function requireFixtureHandle(
  files: readonly AST.TaoFile[],
  path: string,
  handle: string,
  entity: string,
  entityPath: string,
): void {
  const fixtures = files.find(file => AST.getDocument(file).uri.fsPath === path)?.statements
    .filter(AST.isFixtureDeclaration).filter(fixture => fixture.name === 'Sketches') ?? []
  const values = fixtures.flatMap(fixture => AST.fixtureValueDeclarations(fixture)).filter(value =>
    value.name === handle
  )
  const value = values[0]
  Assert.input(
    values.length === 1 && AST.isFixtureCreateBinding(value) && value.entity.ref?.singularName === entity
      && AST.getDocument(value.entity.ref).uri.fsPath === entityPath,
    `Feed fixture handle ${handle} does not create ${entity}.`,
  )
}

function scenarioValue(value: AST.Node): StudioScenarioArgumentValue {
  if (AST.isStringLiteral(value) || AST.isNumberLiteral(value)) {
    return value.value
  }
  if (AST.isBooleanLiteral(value)) {
    return value.value === 'true'
  }
  if (AST.isNowExpression(value)) {
    return { kind: 'now' }
  }
  if (AST.isFixtureValueReference(value)) {
    return { handle: value.target.$refText, kind: 'fixture-reference' }
  }
  return Errors.throwUserInput('Feed cannot preserve this scenario argument expression.')
}
