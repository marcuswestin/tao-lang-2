import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

type NamedValueDeclaration =
  | NamedFileValueDeclaration
  | AST.ParameterDeclaration
type NamedFileValueDeclaration =
  | AST.AliasDeclaration
  | AST.AppDeclaration
  | AST.RenderableDeclaration
type NamedDeclaration = NamedValueDeclaration | AST.TypeDeclaration
type ValueReferenceLike = AST.ValueReference | AST.MemberAccessExpression

/** aliasValidationMessages declares name and alias-reference diagnostics. */
export const aliasValidationMessages = {
  duplicateName: (name: string) => `Duplicate name '${name}'.`,
  aliasUsedBeforeDeclaration: (alias: string, value: string) =>
    `Alias '${alias}' cannot reference '${value}' because it is not declared before the alias.`,
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
} as const

/** validateAliases validates duplicate names and alias reference order. */
export function validateAliases(file: AST.TaoFile, ctx: ValidationContext): void {
  const fileValueDeclarations = file.statements.filter(isValueDeclaration)
  const fileTypeDeclarations = file.statements.filter(AST.isTypeDeclaration)
  reportDuplicateNames(fileValueDeclarations, new Map(), ctx)
  reportDuplicateNames(fileTypeDeclarations, new Map(), ctx)
  reportAliasReferenceOrder(allAliases(file), ctx)
  reportLocalValueReferenceOrder(file, ctx)

  const fileRenderables = file.statements.filter(AST.isRenderableDeclaration)
  for (const view of ASTUtils.streamAllContents(file).filter(AST.isRenderableDeclaration)) {
    const parameters = view.parameterList?.parameters ?? []
    reportNameConflicts(parameters, visibleDeclarations(fileRenderables), ctx)
    for (const block of blocksOwnedByView(view)) {
      const blockNames = visibleDeclarations([...fileRenderables, ...parameters])
      reportDuplicateNames(aliasesOwnedByBlock(block), blockNames, ctx)
    }
  }
}

function reportDuplicateNames(
  declarations: readonly NamedDeclaration[],
  visible: Map<string, NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    const name = declarationName(declaration)
    if (visible.has(name)) {
      ctx.error(aliasValidationMessages.duplicateName(name), declaration)
      continue
    }
    visible.set(name, declaration)
  }
}

function reportNameConflicts(
  declarations: readonly NamedDeclaration[],
  visible: Map<string, NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    const name = declarationName(declaration)
    if (visible.has(name)) {
      ctx.error(aliasValidationMessages.duplicateName(name), declaration)
    }
  }
}

function visibleDeclarations(declarations: readonly NamedDeclaration[]): Map<string, NamedDeclaration> {
  return new Map(declarations.map(declaration => [declarationName(declaration), declaration] as const))
}

function allAliases(file: AST.TaoFile): AST.AliasDeclaration[] {
  return ASTUtils.streamAllContents(file).filter(AST.isAliasDeclaration)
}

function reportAliasReferenceOrder(aliases: readonly AST.AliasDeclaration[], ctx: ValidationContext): void {
  for (const alias of aliases) {
    for (const reference of aliasValueReferences(alias)) {
      const target = reference.target.ref
      if (target && !isDeclaredBefore(target, alias)) {
        ctx.error(aliasValidationMessages.aliasUsedBeforeDeclaration(alias.name, declarationName(target)), reference)
      }
    }
  }
}

function reportLocalValueReferenceOrder(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const reference of ASTUtils.streamAllContents(file).filter(isValueReferenceLike)) {
    if (findOwningAlias(reference)) {
      continue
    }
    const target = reference.target.ref
    if (target && AST.isAliasDeclaration(target) && findOwningView(target) && !isDeclaredBefore(target, reference)) {
      ctx.error(aliasValidationMessages.usedBeforeDeclaration(target.name), reference)
    }
  }
}

function aliasValueReferences(alias: AST.AliasDeclaration): ValueReferenceLike[] {
  if (AST.isValueReference(alias.value) || AST.isMemberAccessExpression(alias.value)) {
    return [alias.value]
  }
  return ASTUtils.streamAllContents(alias.value).filter(isValueReferenceLike)
}

function isDeclaredBefore(declaration: AST.ValueDeclaration, use: AST.Node): boolean {
  // Imported declarations initialize with their own module before this file's body runs,
  // so source-order rules only apply within one document.
  if (ASTUtils.getDocument(declaration) !== ASTUtils.getDocument(use)) {
    return true
  }
  const declarationOffset = declaration.$cstNode?.offset
  const useOffset = use.$cstNode?.offset
  return declarationOffset !== undefined && useOffset !== undefined && declarationOffset < useOffset
}

function blocksOwnedByView(view: AST.RenderableDeclaration): AST.Block[] {
  const blocks: AST.Block[] = []
  collectRenderBlocks(view.block, blocks)
  return blocks
}

function collectRenderBlocks(block: AST.Block, blocks: AST.Block[]): void {
  blocks.push(block)
  for (const statement of block.statements) {
    if (AST.isRender(statement) && statement.block) {
      collectRenderBlocks(statement.block, blocks)
    }
  }
}

function aliasesOwnedByBlock(block: AST.Block): AST.AliasDeclaration[] {
  return block.statements.filter(AST.isAliasDeclaration)
}

function declarationName(declaration: NamedDeclaration): string {
  return AST.isParameterDeclaration(declaration) ? Type.parameterName(declaration) : declaration.name
}

function isValueReferenceLike(node: AST.Node): node is ValueReferenceLike {
  return AST.isValueReference(node) || AST.isMemberAccessExpression(node)
}

function isValueDeclaration(node: AST.Node): node is NamedFileValueDeclaration {
  return AST.isAliasDeclaration(node) || AST.isAppDeclaration(node) || AST.isRenderableDeclaration(node)
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
