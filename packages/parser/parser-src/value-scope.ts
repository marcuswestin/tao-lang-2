import { Langium } from './langium-exports'
import type { PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'

/** TaoValueScopeProvider resolves value references through Tao alias and parameter visibility. */
export class TaoValueScopeProvider extends Langium.DefaultScopeProvider {
  constructor(
    private readonly coreServices: Langium.LangiumCoreServices,
    private readonly packages: PackageResolver,
  ) {
    super(coreServices)
  }

  /** getScope returns Tao values visible to a value reference. */
  override getScope(context: Langium.ReferenceInfo): Langium.Scope {
    if (context.property === 'target' && AST.isValueReference(context.container)) {
      return this.createValueScope(context.container)
    }
    if (context.property === 'target' && AST.isMemberAccessExpression(context.container)) {
      return this.createValueScope(context.container)
    }
    if (
      context.property === 'target'
      && (AST.isNamedTypeReference(context.container) || AST.isConstructorTypeReference(context.container))
    ) {
      return this.createTypeScope(context.container)
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
    return super.getScope(context)
  }

  private createValueScope(reference: AST.Node): Langium.Scope {
    const root = findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    let scope = this.createScopeForNodes(root.statements.filter(AST.isAliasDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(reference, AST.isAliasDeclaration), scope)

    const owningView = findOwningView(reference)
    if (owningView) {
      scope = this.createScopeForParameters(owningView.parameterList?.parameters ?? [], scope)
    }

    for (const block of ancestorBlocks(reference).reverse()) {
      scope = this.createScopeForNodes(aliasesOwnedByBlock(block), scope)
    }

    return scope
  }

  private createTypeScope(reference: AST.Node): Langium.Scope {
    const root = findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    let scope = this.createScopeForNodes(root.statements.filter(AST.isTypeDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(reference, AST.isTypeDeclaration), scope)

    const itemConstructor = findOwningItemConstructor(reference)
    if (itemConstructor) {
      const itemType = this.resolveConstructorItemType(itemConstructor)
      if (itemType) {
        scope = this.createScopeForNodes(itemType.properties.filter(property => property.type !== undefined), scope)
      }
    }

    return scope
  }

  private createViewScope(render: AST.Render): Langium.Scope {
    const root = findRoot(render)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isRenderableDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(render, AST.isRenderableDeclaration), scope)
    return scope
  }

  private createAppViewScope(appView: AST.AppView): Langium.Scope {
    const root = findRoot(appView)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isViewDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(appView, AST.isViewDeclaration), scope)
    return scope
  }

  private createUseImportScope(useStatement: AST.UseStatement): Langium.Scope {
    return this.createScopeForNodes(this.collectTargetDeclarations(useStatement))
  }

  private createScopeForParameters(
    parameters: readonly AST.ParameterDeclaration[],
    outerScope: Langium.Scope,
  ): Langium.Scope {
    const firstParameter = parameters[0]
    if (!firstParameter) {
      return outerScope
    }
    const document = Langium.AstUtils.getDocument(firstParameter)
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
    const root = findRoot(node)
    if (!AST.isTaoFile(root)) {
      return []
    }
    const document = Langium.AstUtils.getDocument(node)
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
    const path = currentPath ?? Langium.AstUtils.getDocument(useStatement).uri.path
    const allFiles = Array.from(this.coreServices.shared.workspace.LangiumDocuments.all)
      .map(document => document.parseResult.value)
      .filter(AST.isTaoFile)
    return [...this.packages.collectTargetDeclarations(useStatement, {
      fromFilePath: path,
      workspaceFiles: allFiles,
    })]
  }

  private resolveConstructorItemType(constructor: AST.TypedConstructor): AST.ItemTypeExpression | undefined {
    const definition = constructor.type.target?.ref
    return definition ? this.itemTypeOfDefinition(constructor, definition, new Set()) : undefined
  }

  private visibleTypeDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
    const root = findRoot(node)
    if (!AST.isTaoFile(root)) {
      return undefined
    }
    return [
      ...root.statements.filter(AST.isTypeDeclaration),
      ...this.importedDeclarations(node, AST.isTypeDeclaration),
    ].find(type => type.name === name)
  }

  private itemTypeOfDefinition(
    context: AST.Node,
    definition: AST.TypeDefinition,
    seen: Set<AST.TypeDefinition>,
  ): AST.ItemTypeExpression | undefined {
    if (seen.has(definition)) {
      return undefined
    }
    seen.add(definition)
    if (AST.isTypeDeclaration(definition)) {
      if (AST.isItemTypeExpression(definition.type)) {
        return definition.type
      }
      return AST.isNamedTypeReference(definition.type)
        ? this.itemTypeOfNamedTypeReference(context, definition.type, seen)
        : undefined
    }
    if (!definition.type) {
      const typeDeclaration = this.visibleTypeDeclaration(context, definition.name)
      return typeDeclaration ? this.itemTypeOfDefinition(context, typeDeclaration, seen) : undefined
    }
    return AST.isNamedTypeReference(definition.type)
      ? this.itemTypeOfNamedTypeReference(context, definition.type, seen)
      : undefined
  }

  private itemTypeOfNamedTypeReference(
    context: AST.Node,
    reference: AST.NamedTypeReference,
    seen: Set<AST.TypeDefinition>,
  ): AST.ItemTypeExpression | undefined {
    const definition = this.definitionOfNamedTypeReference(context, reference, seen)
    return definition ? this.itemTypeOfDefinition(context, definition, seen) : undefined
  }

  private definitionOfNamedTypeReference(
    context: AST.Node,
    reference: AST.NamedTypeReference,
    seen: Set<AST.TypeDefinition>,
  ): AST.TypeDefinition | undefined {
    const rootName = reference.target.$refText
    if (!rootName) {
      return undefined
    }
    let current: AST.TypeDefinition | undefined = this.visibleTypeDeclaration(context, rootName)
    for (const member of reference.members) {
      if (!current) {
        return undefined
      }
      const itemType = this.itemTypeOfDefinition(context, current, seen)
      current = itemType?.properties.find(property => property.name === member)
    }
    return current
  }
}

function findOwningView(node: AST.Node): AST.RenderableDeclaration | undefined {
  let current = node.$container
  while (current) {
    if (AST.isRenderableDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

function findRoot(node: AST.Node): AST.Node {
  let current = node
  while (current.$container) {
    current = current.$container
  }
  return current
}

function ancestorBlocks(node: AST.Node): AST.Block[] {
  const blocks: AST.Block[] = []
  let current = node.$container
  while (current) {
    if (AST.isBlock(current)) {
      blocks.push(current)
    }
    current = current.$container
  }
  return blocks
}

function aliasesOwnedByBlock(block: AST.Block): AST.AliasDeclaration[] {
  return block.statements.filter(AST.isAliasDeclaration)
}

function findOwningItemConstructor(node: AST.Node): AST.TypedConstructor | undefined {
  let current = node.$container
  if (AST.isConstructorTypeReference(node) && AST.isTypedConstructor(current) && current.type === node) {
    current = current.$container
  }
  while (current) {
    if (AST.isItemLiteral(current) && AST.isTypedConstructor(current.$container)) {
      return current.$container
    }
    current = current.$container
  }
  return undefined
}

function parameterValueName(parameter: AST.ParameterDeclaration): string | undefined {
  if (parameter.name) {
    return parameter.name
  }
  if (AST.isPrimitiveTypeReference(parameter.type)) {
    return undefined
  }
  const lastMember = parameter.type.members.at(-1)
  return lastMember ?? parameter.type.target.$refText
}
