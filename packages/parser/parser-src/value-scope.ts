import { ASTStructure } from './ASTStructure'
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

  private createValueScope(reference: AST.ValueReference): Langium.Scope {
    const root = ASTStructure.findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    let scope = this.createScopeForNodes(ASTStructure.importableValueDeclarationsInFile(root))
    scope = this.createScopeForNodes(
      this.importedDeclarations(reference, ASTStructure.isImportableValueDeclaration),
      scope,
    )

    const owningView = ASTStructure.findOwningView(reference)
    if (owningView) {
      scope = this.createScopeForNodes(owningView.parameterList?.parameters ?? [], scope)
    }

    for (const block of ASTStructure.ancestorBlocks(reference).reverse()) {
      scope = this.createScopeForNodes(ASTStructure.valueDeclarationsOwnedByBlock(block), scope)
    }

    const owningAction = ASTStructure.findOwningAction(reference)
    if (owningAction) {
      scope = this.createScopeForNodes(owningAction.parameterList?.parameters ?? [], scope)
    }

    return scope
  }

  private createStateScope(setStatement: AST.SetStatement): Langium.Scope {
    let scope = this.createScopeForNodes([])

    for (const block of ASTStructure.ancestorBlocks(setStatement).reverse()) {
      scope = this.createScopeForNodes(statesOwnedByBlock(block), scope)
    }

    return scope
  }

  private createViewScope(render: AST.Render): Langium.Scope {
    const root = ASTStructure.findRoot(render)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }
    let scope = this.createScopeForNodes(root.statements.filter(AST.isRenderableDeclaration))
    scope = this.createScopeForNodes(this.importedDeclarations(render, AST.isRenderableDeclaration), scope)
    return scope
  }

  private createAppViewScope(appView: AST.AppView): Langium.Scope {
    const root = ASTStructure.findRoot(appView)
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

  private importedDeclarations<DeclarationT extends AST.Declaration>(
    node: AST.Node,
    isDeclaration: (node: AST.Node) => node is DeclarationT,
  ): DeclarationT[] {
    const root = ASTStructure.findRoot(node)
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
}

function statesOwnedByBlock(block: AST.Block): AST.StateDeclaration[] {
  return block.statements.filter(AST.isStateDeclaration)
}
