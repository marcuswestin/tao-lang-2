import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

/** TaoValueScopeProvider resolves value references through Tao alias and parameter visibility. */
export class TaoValueScopeProvider extends Langium.DefaultScopeProvider {
  /** getScope returns Tao values visible to a value reference. */
  override getScope(context: Langium.ReferenceInfo): Langium.Scope {
    if (context.property === 'target' && AST.isValueReference(context.container)) {
      return this.createScopeForNodes(visibleValueDeclarations(context.container))
    }
    return super.getScope(context)
  }
}

function visibleValueDeclarations(reference: AST.ValueReference): AST.ValueDeclaration[] {
  const document = Langium.AstUtils.getDocument(reference)
  const root = document.parseResult.value
  if (!AST.isTaoFile(root)) {
    return []
  }

  const owningView = findOwningView(reference)
  const declarations: AST.ValueDeclaration[] = [...root.statements.filter(AST.isAliasDeclaration)]
  if (owningView) {
    declarations.push(...owningView.parameterList?.parameters ?? [])
    declarations.push(...aliasesOwnedByView(owningView))
  }
  return declarations
}

function aliasesOwnedByView(view: AST.ViewDeclaration): AST.AliasDeclaration[] {
  return Langium.AstUtils.streamAllContents(view.block)
    .filter(AST.isAliasDeclaration)
    .filter(alias => findOwningView(alias) === view)
    .toArray()
}

function findOwningView(node: AST.Node): AST.ViewDeclaration | undefined {
  let current = node.$container
  while (current) {
    if (AST.isViewDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}
