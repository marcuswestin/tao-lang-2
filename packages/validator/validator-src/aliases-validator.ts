import { Type } from '@ast-utils'
import { AST } from '@parser'
import { DeclarationOrder } from './DeclarationOrder'
import { aliasValidationCodes } from './diagnostic-codes'
import type { ValidationContext } from './validation'

type NamedValueDeclaration =
  | NamedFileValueDeclaration
  | AST.ParameterDeclaration
  | AST.StateDeclaration
  | AST.LoopVariable
type NamedFileValueDeclaration =
  | AST.ActionDeclaration
  | AST.AliasDeclaration
  | AST.AppDeclaration
  | AST.RenderableDeclaration
type NamedDeclaration = NamedValueDeclaration | AST.TypeDeclaration
type ValueReferenceLike = AST.ValueReference | AST.MemberAccessExpression

/** aliasValidationMessages declares name and alias-reference diagnostics. */
const aliasValidationMessages = {
  duplicateName: (name: string) => `Duplicate name '${name}'.`,
  aliasUsedBeforeDeclaration: (alias: string, value: string) =>
    `Alias '${alias}' cannot reference '${value}' because it is not declared before the alias.`,
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
  deprecatedAlias: (name: string) => `\`alias\` is deprecated. Write \`let ${name} = ...\`.`,
} as const

/** AliasesValidator validates alias names and declaration order. */
export const AliasesValidator = {
  messages: aliasValidationMessages,
  validate,
}

/** validateAliases validates duplicate names and alias reference order. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  const fileValueDeclarations = file.statements.filter(isFileValueDeclaration)
  const fileTypeDeclarations = file.statements.filter(AST.isTypeDeclaration)
  reportDuplicateNames(fileValueDeclarations, new Map(), ctx)
  reportDuplicateNames(fileTypeDeclarations, new Map(), ctx)
  reportAliasReferenceOrder(allAliases(file), ctx)
  reportDeprecatedAliasKeyword(allAliases(file), ctx)
  reportLocalValueReferenceOrder(file, ctx)

  const fileRenderables = file.statements.filter(AST.isRenderableDeclaration)
  for (const view of AST.streamAllContents(file).filter(AST.isRenderableDeclaration)) {
    const parameters = AST.parametersOf(view)
    reportNameConflicts(parameters, visibleDeclarations(fileRenderables), ctx)
    for (const block of blocksOwnedByView(view)) {
      const blockNames = visibleDeclarations([...fileRenderables, ...parameters])
      reportDuplicateNames(AST.valueDeclarationsOwnedByBlock(block), blockNames, ctx)
    }
  }
}

function reportDuplicateNames(
  declarations: readonly NamedDeclaration[],
  visible: Map<string, NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    const name = Type.declarationName(declaration)
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
    const name = Type.declarationName(declaration)
    if (visible.has(name)) {
      ctx.error(aliasValidationMessages.duplicateName(name), declaration)
    }
  }
}

function visibleDeclarations(declarations: readonly NamedDeclaration[]): Map<string, NamedDeclaration> {
  return new Map(declarations.map(declaration => [Type.declarationName(declaration), declaration] as const))
}

function allAliases(file: AST.TaoFile): AST.AliasDeclaration[] {
  return AST.streamAllContents(file).filter(AST.isAliasDeclaration)
}

function reportDeprecatedAliasKeyword(aliases: readonly AST.AliasDeclaration[], ctx: ValidationContext): void {
  for (const alias of aliases) {
    if (alias.keyword === 'alias') {
      ctx.warning(aliasValidationMessages.deprecatedAlias(alias.name), alias, {
        code: aliasValidationCodes.deprecatedAlias,
      })
    }
  }
}

function reportAliasReferenceOrder(aliases: readonly AST.AliasDeclaration[], ctx: ValidationContext): void {
  for (const alias of aliases) {
    for (const reference of aliasValueReferences(alias)) {
      const target = reference.target.ref
      if (isInvalidAliasInitializerReferenceOrder(target, reference, alias)) {
        ctx.error(
          aliasValidationMessages.aliasUsedBeforeDeclaration(alias.name, Type.declarationName(target)),
          reference,
        )
      }
    }
  }
}

function reportLocalValueReferenceOrder(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const reference of AST.streamAllContents(file).filter(isValueReferenceLike)) {
    if (isReferenceInAliasOrStateInitializer(reference)) {
      continue
    }
    const target = reference.target.ref
    if (isInvalidLocalValueReferenceOrder(target, reference)) {
      ctx.error(aliasValidationMessages.usedBeforeDeclaration(Type.declarationName(target)), reference)
    }
  }
}

function aliasValueReferences(alias: AST.AliasDeclaration): ValueReferenceLike[] {
  if (AST.isValueReference(alias.value) || AST.isMemberAccessExpression(alias.value)) {
    return [alias.value]
  }
  return AST.streamAllContents(alias.value).filter(isValueReferenceLike)
}

function isReferenceInAliasOrStateInitializer(reference: ValueReferenceLike): boolean {
  return AST.findOwningAlias(reference) !== undefined
    || AST.findOwningState(reference) !== undefined
}

function isInvalidAliasInitializerReferenceOrder(
  declaration: AST.ValueDeclaration | undefined,
  reference: ValueReferenceLike,
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
      || AST.findOwningView(initializer) === undefined
    )
}

function isInvalidLocalValueReferenceOrder(
  declaration: AST.ValueDeclaration | undefined,
  reference: ValueReferenceLike,
): declaration is AST.ValueDeclaration {
  return declaration !== undefined
    && DeclarationOrder.isLocalValueDeclaration(declaration)
    && DeclarationOrder.isViewOwnedValueDeclaration(declaration)
    && !DeclarationOrder.allowsForwardActionReference(declaration, reference)
    && DeclarationOrder.isUsedBeforeDeclaration(declaration, reference)
}

type ViewOwnedBlock = AST.Block

function blocksOwnedByView(view: AST.RenderableDeclaration): ViewOwnedBlock[] {
  const blocks: ViewOwnedBlock[] = []
  collectRenderChildBlocks(view.block, blocks)
  return blocks
}

function collectRenderChildBlocks(block: ViewOwnedBlock, blocks: ViewOwnedBlock[]): void {
  blocks.push(block)
  for (const statement of block.statements) {
    if (AST.isRender(statement) && statement.block) {
      collectRenderChildBlocks(statement.block, blocks)
    }
  }
}

function isValueReferenceLike(node: AST.Node): node is ValueReferenceLike {
  return AST.isValueReference(node) || AST.isMemberAccessExpression(node)
}

function isFileValueDeclaration(node: AST.Node): node is NamedFileValueDeclaration {
  return AST.isActionDeclaration(node)
    || AST.isAliasDeclaration(node)
    || AST.isAppDeclaration(node)
    || AST.isRenderableDeclaration(node)
}
