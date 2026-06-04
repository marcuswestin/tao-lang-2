import { AST, Langium } from '@parser'
import type { ValidationContext } from './validation'

/** aliasValidationMessages declares alias and visible-name diagnostics. */
export const aliasValidationMessages = {
  duplicateVisibleName: (name: string) => `Value name '${name}' is already declared in this scope.`,
  cycle: (name: string) => `Alias '${name}' cannot reference itself through an alias cycle.`,
} as const

/** validateAliases validates alias names, visible-name conflicts, and alias cycles. */
export function validateAliases(file: AST.TaoFile, ctx: ValidationContext): void {
  const fileAliases = file.statements.filter(AST.isAliasDeclaration)
  reportDuplicateNames(fileAliases, new Map(), ctx)

  for (const view of Langium.AstUtils.streamAllContents(file).filter(AST.isViewDeclaration)) {
    const visible = new Map(fileAliases.map(alias => [alias.name, alias] as const))
    reportDuplicateNames(view.parameterList?.parameters ?? [], visible, ctx)
    reportDuplicateNames(aliasesOwnedByView(view), visible, ctx)
  }

  for (const alias of allAliases(file)) {
    if (hasAliasCycle(alias)) {
      ctx.error(aliasValidationMessages.cycle(alias.name), alias)
    }
  }
}

function reportDuplicateNames(
  declarations: readonly AST.ValueDeclaration[],
  visible: Map<string, AST.ValueDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    if (visible.has(declaration.name)) {
      ctx.error(aliasValidationMessages.duplicateVisibleName(declaration.name), declaration)
      continue
    }
    visible.set(declaration.name, declaration)
  }
}

function allAliases(file: AST.TaoFile): AST.AliasDeclaration[] {
  return Langium.AstUtils.streamAllContents(file).filter(AST.isAliasDeclaration).toArray()
}

function aliasesOwnedByView(view: AST.ViewDeclaration): AST.AliasDeclaration[] {
  return Langium.AstUtils.streamAllContents(view.block)
    .filter(AST.isAliasDeclaration)
    .filter(alias => findOwningView(alias) === view)
    .toArray()
}

function hasAliasCycle(alias: AST.AliasDeclaration, seen = new Set<AST.AliasDeclaration>()): boolean {
  if (seen.has(alias)) {
    return true
  }
  seen.add(alias)

  const value = alias.value
  if (!AST.isValueReference(value)) {
    return false
  }

  const target = value.target.ref
  return AST.isAliasDeclaration(target) ? hasAliasCycle(target, seen) : false
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
