import { Langium } from './langium-exports'
import type { PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'

/** ValueScopeProvider resolves value references through Tao alias and parameter visibility. */
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
      return this.createValueScope(context.container)
    }
    if (context.property === 'target' && AST.isMemberAccessExpression(context.container)) {
      return this.createValueScope(context.container)
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
    if (context.property === 'app' && AST.isRunStep(context.container)) {
      return this.createRunAppScope(context.container)
    }
    if (context.property === 'field' && AST.isQueryOrder(context.container)) {
      return this.createQueryFieldScope(context.container.$container, this.createScopeForNodes([]))
    }
    if (context.property === 'field' && AST.isFieldValue(context.container)) {
      return this.createFieldValueScope(context.container)
    }
    return super.getScope(context)
  }

  // A query's `where` and `order` clauses name the queried entity's fields directly.
  private createQueryFieldScope(query: AST.QueryDeclaration, outerScope: Langium.Scope): Langium.Scope {
    const entity = queriedEntityOf(query)
    return entity ? this.createScopeForNodes(entity.fields, outerScope) : outerScope
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
      scope = this.createScopeForParameters(owningView, scope)
    }

    for (const block of AST.ancestorBlocks(reference).reverse()) {
      scope = this.createScopeForNodes(AST.valueDeclarationsOwnedByBlock(block), scope)
    }

    const owningAction = AST.findOwningAction(reference)
    if (owningAction) {
      scope = this.createScopeForParameters(owningAction, scope)
    }

    // An event clause's payload parameter is visible only inside that clause's body.
    const owningEventClause = AST.findOwningEventClause(reference)
    if (owningEventClause) {
      scope = this.createScopeForParameterList(owningEventClause.parameterList, scope)
    }

    const owningQuery = AST.findOwningQuery(reference)
    if (owningQuery) {
      scope = this.createQueryFieldScope(owningQuery, scope)
    }

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

  private createAppViewScope(appView: AST.AppView): Langium.Scope {
    const root = AST.findRoot(appView)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isViewDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(appView, AST.isViewDeclaration), scope)
    return scope
  }

  private createRunAppScope(run: AST.RunStep): Langium.Scope {
    const root = AST.findRoot(run)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isAppDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(run, AST.isAppDeclaration), scope)
    return scope
  }

  // A mutation's field names come from the entity it creates or updates.
  private createFieldValueScope(fieldValue: AST.FieldValue): Langium.Scope {
    const entity = mutationEntityOf(fieldValue.$container)
    return entity ? this.createScopeForNodes(entity.fields) : this.createScopeForNodes([])
  }

  private createUseImportScope(useStatement: AST.UseStatement): Langium.Scope {
    return this.createScopeForNodes(this.collectTargetDeclarations(useStatement))
  }

  private createScopeForParameterList(
    parameterList: AST.ParameterList | undefined,
    outerScope: Langium.Scope,
  ): Langium.Scope {
    return this.createScopeForParameterNodes(parameterList?.parameters ?? [], outerScope)
  }

  private createScopeForParameters(
    declaration: AST.RenderableDeclaration | AST.ActionDeclaration,
    outerScope: Langium.Scope,
  ): Langium.Scope {
    return this.createScopeForParameterNodes(AST.parametersOf(declaration), outerScope)
  }

  // A parameter's value name comes from its inline type or named type, not from a `name` property.
  private createScopeForParameterNodes(
    parameters: readonly AST.ParameterDeclaration[],
    outerScope: Langium.Scope,
  ): Langium.Scope {
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

function mutationEntityOf(
  statement: AST.CreateStatement | AST.UpdateStatement,
): AST.EntityDeclaration | undefined {
  if (AST.isCreateStatement(statement)) {
    const schema = dataDeclarationNamed(statement, statement.entity.root)
    const [entityName] = statement.entity.members
    return entityName ? schema?.entities.find(entity => entity.name === entityName) : undefined
  }
  return entityOfTarget(statement.target)
}

// An update target names a value whose declaration is an entity-typed loop variable or parameter.
function entityOfTarget(target: AST.MemberOrValueExpression): AST.EntityDeclaration | undefined {
  const declaration = AST.isValueReference(target) ? target.target.ref : target.target.ref
  if (!declaration) {
    return undefined
  }
  if (AST.isLoopVariable(declaration)) {
    const collection = declaration.$container.collection
    return AST.isValueReference(collection) && AST.isQueryDeclaration(collection.target.ref)
      ? queriedEntityOf(collection.target.ref)
      : undefined
  }
  if (AST.isParameterDeclaration(declaration)) {
    return entityOfTypeReference(declaration, parameterTypeReference(declaration))
  }
  return undefined
}

function parameterTypeReference(parameter: AST.ParameterDeclaration): AST.NamedTypeReference | undefined {
  if (parameter.type) {
    return parameter.type
  }
  const inlineType = parameter.inlineType?.type
  return inlineType && AST.isNamedTypeReference(inlineType) ? inlineType : undefined
}

function entityOfTypeReference(
  node: AST.Node,
  reference: AST.NamedTypeReference | undefined,
): AST.EntityDeclaration | undefined {
  if (!reference) {
    return undefined
  }
  const schema = dataDeclarationNamed(node, reference.root)
  const [entityName] = reference.members
  return entityName
    ? schema?.entities.find(entity => entity.name === entityName || entity.collection === entityName)
    : undefined
}

function queriedEntityOf(query: AST.QueryDeclaration): AST.EntityDeclaration | undefined {
  const [collectionName] = query.collection.members
  const schema = dataDeclarationNamed(query, query.collection.root)
  return collectionName && schema
    ? schema.entities.find(entity => entity.collection === collectionName)
    : undefined
}

function dataDeclarationNamed(node: AST.Node, name: string): AST.DataDeclaration | undefined {
  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  const declared = root.statements.filter(AST.isDataDeclaration).find(data => data.name === name)
  if (declared) {
    return declared
  }
  return root.statements
    .filter(AST.isUseStatement)
    .flatMap(useStatement => useStatement.importedDeclarations.map(reference => reference.ref))
    .filter(AST.isDataDeclaration)
    .find(data => data.name === name)
}

function statesOwnedByBlock(block: AST.Block): AST.StateDeclaration[] {
  return block.statements.filter(AST.isStateDeclaration)
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
