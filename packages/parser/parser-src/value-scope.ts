import { Langium } from './langium-exports'
import type { PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'

/** ValueScopeProvider resolves value references through Tao binding and parameter visibility. */
export class ValueScopeProvider extends Langium.DefaultScopeProvider {
  constructor(
    private readonly coreServices: Langium.LangiumCoreServices,
    private readonly packages: PackageResolver,
  ) {
    super(coreServices)
  }

  /** getScope returns Tao values visible to a value reference. */
  override getScope(context: Langium.ReferenceInfo): Langium.Scope {
    if (
      context.property === 'target'
      && (AST.isSetStatement(context.container) || AST.isToggleStatement(context.container))
    ) {
      return this.createStateScope(context.container)
    }
    if (context.property === 'target' && AST.isValueReference(context.container)) {
      if (AST.isDataWriteField(context.container.$container)) {
        return this.createDataWriteValueScope(context.container)
      }
      return this.createValueScope(context.container)
    }
    if (context.property === 'target' && AST.isMemberAccessExpression(context.container)) {
      return this.createValueScope(context.container)
    }
    if (context.property === 'case' && AST.isBooleanWhereClause(context.container)) {
      return this.createBooleanWhereScope(context.container)
    }
    if (context.property === 'type' && AST.isConfiguredValue(context.container)) {
      return this.createConfiguredTypeScope(context.container)
    }
    if (context.property === 'ui' && AST.isContextualPresentStatement(context.container)) {
      return this.createUiScope(context.container)
    }
    if (context.property === 'function' && AST.isFunctionCallExpression(context.container)) {
      return this.createFunctionScope(context.container)
    }
    if (context.property === 'importedDeclarations' && AST.isUseStatement(context.container)) {
      return this.createUseImportScope(context.container)
    }
    if (context.property === 'view' && AST.isRender(context.container)) {
      return this.createViewScope(context.container)
    }
    if (context.property === 'view' && AST.isAppView(context.container)) {
      return this.createAppViewScope(context.container)
    }
    if (context.property === 'entity' && AST.isCreateStatement(context.container)) {
      return this.createEntityDataScope(context.container)
    }
    if (context.property === 'app' && AST.isRunStep(context.container)) {
      return this.createRunAppScope(context.container)
    }
    if (context.property === 'app' && AST.isNavigationTarget(context.container)) {
      return this.createRunAppScope(context.container)
    }
    return super.getScope(context)
  }

  private createValueScope(reference: AST.Node): Langium.Scope {
    const root = AST.findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    let scope = this.createScopeForNodes(AST.importableValueDeclarationsInFile(root))
    scope = this.createScopeForNodes(
      this.importedDeclarations(reference, AST.isImportableValueDeclaration),
      scope,
    )

    const owningView = AST.findOwningView(reference)
    if (owningView) {
      scope = this.createScopeForParameters(owningView, scope, reference)
    }

    const owningFunction = AST.findOwningFunction(reference)
    if (owningFunction) {
      scope = this.createScopeForParameters(owningFunction, scope, reference)
    }

    const owningAction = AST.findOwningAction(reference)
    if (owningAction) {
      scope = this.createScopeForParameters(owningAction, scope, reference)
    }

    // Blocks and case payloads layer together at their lexical depth, so a handler payload wins
    // over outer bindings while bindings declared inside the handler shadow the payload.
    for (const carrier of scopeCarriersContaining(reference).reverse()) {
      if (carrier.kind === 'payload') {
        scope = this.createScopeForNodes([carrier.payload], scope)
        continue
      }
      const forBinding = AST.forBindingOwnedByBlock(carrier.block)
      if (forBinding) {
        scope = this.createScopeForNodes([forBinding], scope)
      }
      scope = this.createScopeForNodes(AST.valueDeclarationsOwnedByBlock(carrier.block), scope)
    }

    return scope
  }

  private createConfiguredTypeScope(node: AST.ConfiguredValue): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isTypeDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(node, AST.isTypeDeclaration), scope)
    return scope
  }

  private createUiScope(node: AST.ContextualPresentStatement): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isUiDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(node, AST.isUiDeclaration), scope)
    return scope
  }

  private createStateScope(statement: AST.SetStatement | AST.ToggleStatement): Langium.Scope {
    let scope = this.createScopeForNodes([])

    for (const block of AST.ancestorBlocks(statement).reverse()) {
      scope = this.createScopeForNodes(statesOwnedByBlock(block), scope)
    }

    return scope
  }

  private createViewScope(render: AST.Render): Langium.Scope {
    const root = AST.findRoot(render)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isRenderableDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(render, AST.isRenderableDeclaration), scope)
    return scope
  }

  private createFunctionScope(call: AST.FunctionCallExpression): Langium.Scope {
    const root = AST.findRoot(call)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isFunctionDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(call, AST.isFunctionDeclaration), scope)
    return scope
  }

  private createAppViewScope(node: AST.AppView): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isViewDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(node, AST.isViewDeclaration), scope)
    return scope
  }

  private createEntityDataScope(node: AST.Node): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    const declarations = [
      ...root.statements.filter(AST.isEntityDataDeclaration),
      ...this.importedDeclarations(node, AST.isEntityDataDeclaration),
    ]
    const descriptions = declarations.map(declaration =>
      this.descriptions.createDescription(declaration, declaration.singularName, AST.getDocument(declaration))
    )
    return this.createScope(descriptions)
  }

  private createDataWriteValueScope(reference: AST.ValueReference): Langium.Scope {
    const outer = this.createValueScope(reference)
    const write = reference.$container
    const block = AST.isDataWriteField(write) ? write.$container : undefined
    const operation = block?.$container
    const entity = entityDataForWrite(operation)
    if (!entity) {
      return outer
    }
    const document = AST.getDocument(entity)
    const descriptions = entity.block.entries.filter(AST.isEntityDataField).flatMap(field => {
      if (!field.negativeName) {
        return []
      }
      return [
        this.descriptions.createDescription(field, field.name, document),
        this.descriptions.createDescription(field, field.negativeName, document),
      ]
    })
    return this.createScope(descriptions, outer)
  }

  private createBooleanWhereScope(where: AST.BooleanWhereClause): Langium.Scope {
    const query = where.$container.$container
    const entity = AST.isEntityQueryDeclaration(query) ? entityDataForQuery(query) : undefined
    if (!entity) {
      return this.createScopeForNodes([])
    }
    const descriptions = entity.block.entries.filter(AST.isEntityDataField).flatMap(field => {
      if (!field.negativeName) {
        return []
      }
      const document = AST.getDocument(field)
      return [
        this.descriptions.createDescription(field, field.name, document),
        this.descriptions.createDescription(field, field.negativeName, document),
      ]
    })
    return this.createScope(descriptions)
  }

  private createRunAppScope(node: AST.RunStep | AST.NavigationTarget): Langium.Scope {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isAppDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(node, AST.isAppDeclaration), scope)
    return scope
  }

  private createUseImportScope(useStatement: AST.UseStatement): Langium.Scope {
    return this.createScopeForNodes(this.collectTargetDeclarations(useStatement))
  }

  private createScopeForParameters(
    declaration: AST.ParameterizedDeclaration,
    outerScope: Langium.Scope,
    reference?: AST.Node,
  ): Langium.Scope {
    const parameters = visibleParametersAtReference(declaration, reference)
    const firstParameter = parameters[0]
    if (!firstParameter) {
      return outerScope
    }
    const document = AST.getDocument(firstParameter)
    const descriptions = parameters.flatMap(parameter => {
      const name = parameterValueName(parameter)
      return name ? [this.descriptions.createDescription(parameter, name, document)] : []
    })
    return this.createScope(descriptions, outerScope)
  }

  private importedDeclarations<DeclarationT extends AST.Declaration>(
    node: AST.Node,
    isDeclaration: (node: AST.Node) => node is DeclarationT,
  ): DeclarationT[] {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return []
    }
    const document = AST.getDocument(node)
    const currentPath = document.uri.path

    const declarations: DeclarationT[] = []
    for (const useStatement of root.statements.filter(AST.isUseStatement)) {
      const importedNames = new Set(useStatement.importedDeclarations.map(reference => reference.$refText))
      for (const statement of this.collectTargetDeclarations(useStatement, currentPath)) {
        if (AST.isDeclaration(statement) && isDeclaration(statement) && importedNames.has(statement.name)) {
          declarations.push(statement)
        }
      }
    }
    return declarations
  }

  private collectTargetDeclarations(useStatement: AST.UseStatement, currentPath?: string): AST.Declaration[] {
    const path = currentPath ?? AST.getDocument(useStatement).uri.path
    const allFiles = Array.from(this.coreServices.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    return [...this.packages.collectTargetDeclarations(useStatement, {
      fromFilePath: path,
      workspaceFiles: allFiles,
    })]
  }
}

function entityDataForWrite(operation: AST.Node | undefined): AST.EntityDataDeclaration | undefined {
  if (AST.isCreateStatement(operation)) {
    return operation.entity?.ref
  }
  if (!AST.isUpdateStatement(operation) || !AST.isValueReference(operation.target)) {
    return undefined
  }
  return entityDataForValueDeclaration(operation.target.target.ref, operation)
}

function entityDataForValueDeclaration(
  declaration: AST.ValueDeclaration | undefined,
  context: AST.Node,
): AST.EntityDataDeclaration | undefined {
  if (AST.isParameterDeclaration(declaration) && declaration.type?.members.length === 0) {
    return visibleEntityDataDeclarations(context).find(entity => entity.singularName === declaration.type?.root)
  }
  if (AST.isForStatement(declaration)) {
    return entityDataForCollection(declaration.collection, context)
  }
  return undefined
}

function entityDataForCollection(
  collection: AST.Expression,
  context: AST.Node,
): AST.EntityDataDeclaration | undefined {
  if (AST.isValueReference(collection) && AST.isEntityQueryDeclaration(collection.target.ref)) {
    return entityDataForQuery(collection.target.ref)
  }
  if (!AST.isMemberAccessExpression(collection)) {
    return undefined
  }
  const owner = entityDataForValueDeclaration(collection.target.ref, context)
  const fieldName = collection.members.at(-1)
  if (!owner || !fieldName) {
    return undefined
  }
  return visibleEntityDataDeclarations(context).find(entity => entity.name === fieldName)
}

function entityDataForQuery(query: AST.EntityQueryDeclaration): AST.EntityDataDeclaration | undefined {
  if (query.source) {
    return entityDataForCollection(query.source, query)
  }
  const sourceName = query.sourceName ?? query.name
  return visibleEntityDataDeclarations(query).find(entity => entity.name === sourceName)
}

function visibleEntityDataDeclarations(node: AST.Node): AST.EntityDataDeclaration[] {
  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root)) {
    return []
  }
  return [
    ...root.statements.filter(AST.isEntityDataDeclaration),
    ...root.statements
      .filter(AST.isUseStatement)
      .flatMap(useStatement =>
        useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isEntityDataDeclaration)
      ),
  ]
}

type ScopeCarrier =
  | { kind: 'block'; block: AST.Block }
  | { kind: 'payload'; payload: AST.CasePayload }

/** scopeCarriersContaining returns blocks and case payloads from innermost to outermost. */
function scopeCarriersContaining(node: AST.Node): ScopeCarrier[] {
  const carriers: ScopeCarrier[] = []
  let current: AST.Node | undefined = node.$container
  while (current) {
    if (AST.isBlock(current)) {
      carriers.push({ kind: 'block', block: current })
    }
    if (
      (AST.isGuardActionBranch(current) || AST.isGuardRenderBranch(current) || AST.isWhenRenderBranch(current))
      && current.payload
    ) {
      carriers.push({ kind: 'payload', payload: current.payload })
    }
    if (AST.isEventHandler(current) && current.payload) {
      carriers.push({ kind: 'payload', payload: current.payload })
    }
    current = current.$container
  }
  return carriers
}

function statesOwnedByBlock(block: AST.Block): AST.StateDeclaration[] {
  return block.statements.filter(AST.isStateDeclaration)
}

function visibleParametersAtReference(
  declaration: AST.ParameterizedDeclaration,
  reference: AST.Node | undefined,
): readonly AST.ParameterDeclaration[] {
  const parameters = AST.parametersOf(declaration)
  const defaultParameter = parameterOwningDefault(reference)
  const index = defaultParameter ? parameters.indexOf(defaultParameter) : -1
  return index >= 0 ? parameters.slice(0, index) : parameters
}

function parameterOwningDefault(node: AST.Node | undefined): AST.ParameterDeclaration | undefined {
  let current = node
  while (current) {
    if (AST.isParameterDeclaration(current)) {
      return current.defaultValue ? current : undefined
    }
    current = current.$container
  }
  return undefined
}

function parameterValueName(parameter: AST.ParameterDeclaration): string | undefined {
  if (parameter.inlineType) {
    return parameter.inlineType.name
  }
  if (!parameter.type) {
    return undefined
  }
  const lastMember = parameter.type.members.at(-1)
  return lastMember ?? parameter.type.root
}
