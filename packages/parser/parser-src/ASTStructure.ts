import * as AST from './parserASTExport'

/** ASTStructure groups Tao AST ownership and declaration-collection helpers. */
export const ASTStructure = {
  ancestorBlocks,
  findOwningAction,
  findOwningActionBlock,
  findOwningAlias,
  findOwningState,
  findOwningView,
  findRoot,
  importableValueDeclarationsInFile,
  isImportableValueDeclaration,
  valueDeclarationsOwnedByBlock,
}

/** findRoot returns the root AST node that owns `node`. */
function findRoot(node: AST.Node): AST.Node {
  let current = node
  while (current.$container) {
    current = current.$container
  }
  return current
}

/** ancestorBlocks returns the innermost-to-outermost block ancestors for `node`. */
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

/** importableValueDeclarationsInFile returns file-level value declarations visible to other files. */
function importableValueDeclarationsInFile(
  file: AST.TaoFile,
): Array<AST.AliasDeclaration | AST.ActionDeclaration> {
  return file.statements.filter(isImportableValueDeclaration)
}

/** valueDeclarationsOwnedByBlock returns value declarations owned directly by `block`. */
function valueDeclarationsOwnedByBlock(block: AST.Block): AST.ValueDeclaration[] {
  return [
    ...block.statements.filter(AST.isAliasDeclaration),
    ...block.statements.filter(AST.isStateDeclaration),
    ...block.statements.filter(AST.isActionDeclaration),
  ]
}

/** isImportableValueDeclaration returns true for value declarations that can be imported. */
function isImportableValueDeclaration(node: AST.Node): node is AST.AliasDeclaration | AST.ActionDeclaration {
  return AST.isAliasDeclaration(node) || AST.isActionDeclaration(node)
}

/** findOwningView returns the renderable declaration that owns `node`, if any. */
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

/** findOwningAction returns the action declaration that owns `node`, if any. */
function findOwningAction(node: AST.Node): AST.ActionDeclaration | undefined {
  let current = node.$container
  while (current) {
    if (AST.isActionDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

/** findOwningActionBlock returns the named or inline action block that owns `node`, if any. */
function findOwningActionBlock(node: AST.Node): AST.ActionBlock | undefined {
  let current = node.$container
  while (current) {
    if (AST.isActionBlock(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

/** findOwningAlias returns the alias declaration that owns `node`, if any. */
function findOwningAlias(node: AST.Node): AST.AliasDeclaration | undefined {
  let current = node.$container
  while (current) {
    if (AST.isAliasDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

/** findOwningState returns the state declaration that owns `node`, if any. */
function findOwningState(node: AST.Node): AST.StateDeclaration | undefined {
  let current = node.$container
  while (current) {
    if (AST.isStateDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}
