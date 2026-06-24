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
    if (context.property === 'target' && AST.isSetStatement(context.container)) {
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
      scope = this.createScopeForParameters(owningView, scope)
    }

    for (const block of AST.ancestorBlocks(reference).reverse()) {
      scope = this.createScopeForNodes(AST.valueDeclarationsOwnedByBlock(block), scope)
    }

    const owningAction = AST.findOwningAction(reference)
    if (owningAction) {
      scope = this.createScopeForParameters(owningAction, scope)
    }

    return scope
  }

  private createStateScope(setStatement: AST.SetStatement): Langium.Scope {
    let scope = this.createScopeForNodes([])

    for (const block of AST.ancestorBlocks(setStatement).reverse()) {
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

  private createUseImportScope(useStatement: AST.UseStatement): Langium.Scope {
    return this.createScopeForNodes(this.collectTargetDeclarations(useStatement))
  }

  private createScopeForParameters(
    declaration: AST.RenderableDeclaration | AST.ActionDeclaration,
    outerScope: Langium.Scope,
  ): Langium.Scope {
    const parameters = AST.parametersOf(declaration)
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
