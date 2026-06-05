import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** aliasValidationMessages declares name and alias-reference diagnostics. */
export const aliasValidationMessages = {
  duplicateName: (name: string) => `Duplicate name '${name}'.`,
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
} as const

/** validateAliases validates duplicate names and alias reference order. */
export function validateAliases(file: AST.TaoFile, ctx: ValidationContext): void {
  const fileDeclarations = file.statements.filter(AST.isDeclaration)
  reportDuplicateNames(fileDeclarations, new Map(), ctx)
  reportAliasReferenceOrder(allAliases(file), ctx)
  reportLocalValueReferenceOrder(file, ctx)

  for (const view of ASTUtils.streamAllContents(file).filter(AST.isViewDeclaration)) {
    const visible = new Map(fileDeclarations.map(declaration => [declaration.name, declaration] as const))
    reportNameCollisions(view.parameterList?.parameters ?? [], visible, ctx)
    addVisibleNames(view.parameterList?.parameters ?? [], visible)
    reportDuplicateNames(aliasesOwnedByView(view), visible, ctx)
  }
}

function reportNameCollisions(
  declarations: readonly NamedDeclaration[],
  visible: Map<string, NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    if (visible.has(declaration.name)) {
      ctx.error(aliasValidationMessages.duplicateName(declaration.name), declaration)
    }
  }
}

function addVisibleNames(declarations: readonly NamedDeclaration[], visible: Map<string, NamedDeclaration>): void {
  for (const declaration of declarations) {
    if (!visible.has(declaration.name)) {
      visible.set(declaration.name, declaration)
    }
  }
}

function reportDuplicateNames(
  declarations: readonly NamedDeclaration[],
  visible: Map<string, NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    if (visible.has(declaration.name)) {
      ctx.error(aliasValidationMessages.duplicateName(declaration.name), declaration)
      continue
    }
    visible.set(declaration.name, declaration)
  }
}

function allAliases(file: AST.TaoFile): AST.AliasDeclaration[] {
  return ASTUtils.streamAllContents(file).filter(AST.isAliasDeclaration)
}

function reportAliasReferenceOrder(aliases: readonly AST.AliasDeclaration[], ctx: ValidationContext): void {
  for (const alias of aliases) {
    for (const reference of aliasValueReferences(alias)) {
      const target = reference.target.ref
      if (target && !isDeclaredBefore(target, alias)) {
        ctx.error(aliasValidationMessages.usedBeforeDeclaration(target.name), reference)
      }
    }
  }
}

function reportLocalValueReferenceOrder(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const reference of ASTUtils.streamAllContents(file).filter(AST.isValueReference)) {
    if (findOwningAlias(reference)) {
      continue
    }
    const target = reference.target.ref
    if (target && AST.isAliasDeclaration(target) && findOwningView(target) && !isDeclaredBefore(target, reference)) {
      ctx.error(aliasValidationMessages.usedBeforeDeclaration(target.name), reference)
    }
  }
}

function aliasValueReferences(alias: AST.AliasDeclaration): AST.ValueReference[] {
  if (AST.isValueReference(alias.value)) {
    return [alias.value]
  }
  return ASTUtils.streamAllContents(alias.value).filter(AST.isValueReference)
}

function isDeclaredBefore(declaration: AST.ValueDeclaration, use: AST.Node): boolean {
  const declarationOffset = declaration.$cstNode?.offset
  const useOffset = use.$cstNode?.offset
  return declarationOffset !== undefined && useOffset !== undefined && declarationOffset < useOffset
}

function aliasesOwnedByView(view: AST.ViewDeclaration): AST.AliasDeclaration[] {
  return ASTUtils.streamAllContents(view.block)
    .filter(AST.isAliasDeclaration)
    .filter(alias => findOwningView(alias) === view)
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

type NamedDeclaration = AST.Declaration | AST.ValueDeclaration
