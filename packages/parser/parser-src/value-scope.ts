import { Langium } from './langium-exports'
import * as AST from './parserASTExport'

/** TaoValueScopeProvider resolves value references through Tao alias and parameter visibility. */
export class TaoValueScopeProvider extends Langium.DefaultScopeProvider {
  /** getScope returns Tao values visible to a value reference. */
  override getScope(context: Langium.ReferenceInfo): Langium.Scope {
    if (context.property === 'target' && AST.isValueReference(context.container)) {
      return this.createValueScope(context.container)
    }
    return super.getScope(context)
  }

  private createValueScope(reference: AST.ValueReference): Langium.Scope {
    const root = findRoot(reference)
    if (!AST.isTaoFile(root)) {
      return this.createScopeForNodes([])
    }

    let scope = this.createScopeForNodes(root.statements.filter(AST.isAliasDeclaration))

    const owningView = findOwningView(reference)
    if (owningView) {
      scope = this.createScopeForNodes(owningView.parameterList?.parameters ?? [], scope)
    }

    for (const block of ancestorBlocks(reference).reverse()) {
      scope = this.createScopeForNodes(aliasesOwnedByBlock(block), scope)
    }

    return scope
  }
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
