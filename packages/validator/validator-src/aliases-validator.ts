import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { DeclarationOrder } from './DeclarationOrder'
import type { ValidationContext } from './validation'

/** aliasValidationMessages declares name and alias-reference diagnostics. */
const aliasValidationMessages = {
  duplicateName: (name: string) => `Duplicate name '${name}'.`,
  aliasUsedBeforeDeclaration: (alias: string, value: string) =>
    `Alias '${alias}' cannot reference '${value}' because it is not declared before the alias.`,
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
} as const

/** AliasesValidator validates alias names and declaration order. */
export const AliasesValidator = {
  messages: aliasValidationMessages,
  validate,
}

/** validateAliases validates duplicate names and alias reference order. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  const fileDeclarations = file.statements.filter(AST.isDeclaration)
  reportDuplicateNames(fileDeclarations, new Map(), ctx)
  reportAliasReferenceOrder(allAliases(file), ctx)
  reportLocalValueReferenceOrder(file, ctx)

  const fileRenderables = file.statements.filter(AST.isRenderableDeclaration)
  for (const view of ASTUtils.streamAllContents(file).filter(AST.isRenderableDeclaration)) {
    const parameters = view.parameterList?.parameters ?? []
    reportNameConflicts(parameters, visibleDeclarations(fileRenderables), ctx)
    for (const block of blocksOwnedByView(view)) {
      const blockNames = visibleDeclarations([...fileRenderables, ...parameters])
      reportDuplicateNames(DeclarationOrder.valueDeclarationsOwnedByBlock(block), blockNames, ctx)
    }
  }
}

function reportDuplicateNames(
  declarations: readonly AST.NamedDeclaration[],
  visible: Map<string, AST.NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    if (hasVisibleNameConflict(declaration, visible)) {
      ctx.error(aliasValidationMessages.duplicateName(declaration.name), declaration)
      continue
    }
    visible.set(declaration.name, declaration)
  }
}

function reportNameConflicts(
  declarations: readonly AST.NamedDeclaration[],
  visible: Map<string, AST.NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    if (hasVisibleNameConflict(declaration, visible)) {
      ctx.error(aliasValidationMessages.duplicateName(declaration.name), declaration)
    }
  }
}

function hasVisibleNameConflict(
  declaration: AST.NamedDeclaration,
  visible: ReadonlyMap<string, AST.NamedDeclaration>,
): boolean {
  return visible.has(declaration.name)
}

function visibleDeclarations(declarations: readonly AST.NamedDeclaration[]): Map<string, AST.NamedDeclaration> {
  return new Map(declarations.map(declaration => [declaration.name, declaration] as const))
}

function allAliases(file: AST.TaoFile): AST.AliasDeclaration[] {
  return ASTUtils.streamAllContents(file).filter(AST.isAliasDeclaration)
}

function reportAliasReferenceOrder(aliases: readonly AST.AliasDeclaration[], ctx: ValidationContext): void {
  for (const alias of aliases) {
    for (const reference of aliasValueReferences(alias)) {
      const target = reference.target.ref
      if (isInvalidAliasInitializerReferenceOrder(target, reference, alias)) {
        ctx.error(aliasValidationMessages.aliasUsedBeforeDeclaration(alias.name, target.name), reference)
      }
    }
  }
}

function reportLocalValueReferenceOrder(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const reference of ASTUtils.streamAllContents(file).filter(AST.isValueReference)) {
    if (isReferenceInAliasOrStateInitializer(reference)) {
      continue
    }
    const target = reference.target.ref
    if (isInvalidLocalValueReferenceOrder(target, reference)) {
      ctx.error(aliasValidationMessages.usedBeforeDeclaration(target.name), reference)
    }
  }
}

function aliasValueReferences(alias: AST.AliasDeclaration): AST.ValueReference[] {
  return DeclarationOrder.valueReferences(alias.value)
}

function isReferenceInAliasOrStateInitializer(reference: AST.ValueReference): boolean {
  return DeclarationOrder.findOwningAlias(reference) !== undefined
    || DeclarationOrder.findOwningState(reference) !== undefined
}

function isInvalidAliasInitializerReferenceOrder(
  declaration: AST.ValueDeclaration | undefined,
  reference: AST.ValueReference,
  alias: AST.AliasDeclaration,
): declaration is AST.ValueDeclaration {
  return isInitializerReferenceOrderSensitive(declaration, alias)
    && !DeclarationOrder.allowsForwardActionReference(declaration, reference)
    && DeclarationOrder.isUsedBeforeDeclaration(declaration, alias)
}

function isInitializerReferenceOrderSensitive(
  declaration: AST.ValueDeclaration | undefined,
  initializer: AST.AliasDeclaration,
): declaration is AST.ValueDeclaration {
  return declaration !== undefined
    && (
      DeclarationOrder.isViewOwnedValueDeclaration(declaration)
      || DeclarationOrder.findOwningView(initializer) === undefined
    )
}

function isInvalidLocalValueReferenceOrder(
  declaration: AST.ValueDeclaration | undefined,
  reference: AST.ValueReference,
): declaration is AST.ValueDeclaration {
  return declaration !== undefined
    && DeclarationOrder.isLocalValueDeclaration(declaration)
    && DeclarationOrder.isViewOwnedValueDeclaration(declaration)
    && !DeclarationOrder.allowsForwardActionReference(declaration, reference)
    && DeclarationOrder.isUsedBeforeDeclaration(declaration, reference)
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
