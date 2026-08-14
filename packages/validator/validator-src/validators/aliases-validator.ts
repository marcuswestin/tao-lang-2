import { Type } from '@ast-utils'
import { AST } from '@parser'
import { DeclarationOrder } from '../DeclarationOrder'
import type { ValidationContext } from '../validation'

type NamedValueDeclaration =
  | NamedFileValueDeclaration
  | AST.ParameterDeclaration
  | AST.StateDeclaration
  | AST.EntityQueryDeclaration
  | AST.ForStatement
  | AST.AskStatement
  | AST.CasePayload
  | AST.EnumCase
type NamedFileValueDeclaration =
  | AST.ActionDeclaration
  | AST.AliasDeclaration
  | AST.AppDeclaration
  | AST.FunctionDeclaration
  | AST.EnumDeclaration
  | AST.VisualDeclaration
type NamedDeclaration = NamedValueDeclaration | AST.TypeDeclaration
type ValueReferenceLike = AST.ValueReference | AST.MemberAccessExpression

/** aliasValidationMessages declares name and immutable-binding reference diagnostics. */
const aliasValidationMessages = {
  duplicateName: (name: string) => `Duplicate name '${name}'.`,
  reservedName: (name: string) => `Name '${name}' is reserved by Tao's generated runtime scope.`,
  aliasUsedBeforeDeclaration: (binding: string, value: string) =>
    `Binding '${binding}' cannot reference '${value}' because it is not declared before the binding.`,
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
} as const

/** AliasesValidator validates immutable binding names and declaration order. */
export const AliasesValidator = {
  messages: aliasValidationMessages,
  validate,
}

/** validateAliases validates duplicate names and immutable-binding reference order. */
function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  reportReservedRuntimeNames(file, ctx)
  const fileValueDeclarations: NamedValueDeclaration[] = [
    ...file.statements.filter(isFileValueDeclaration),
    ...file.statements.filter(AST.isEnumDeclaration).flatMap(declaration => declaration.block.cases),
  ]
  const fileTypeDeclarations = file.statements.filter(AST.isTypeDeclaration)
  reportDuplicateNames(fileValueDeclarations, new Map(), ctx)
  reportDuplicateNames(fileTypeDeclarations, new Map(), ctx)
  reportAliasReferenceOrder(allAliases(file), ctx)
  reportLocalValueReferenceOrder(file, ctx)

  const fileRenderables = file.statements.filter(AST.isVisualDeclaration)
  for (const view of AST.streamAllContents(file).filter(AST.isVisualDeclaration)) {
    const parameters = AST.parametersOf(view)
    reportNameConflicts(parameters, visibleDeclarations(fileRenderables), ctx)
    for (const block of blocksOwnedByView(view)) {
      const blockNames = visibleDeclarations([...fileRenderables, ...parameters])
      reportDuplicateNames(AST.valueDeclarationsOwnedByBlock(block), blockNames, ctx)
    }
  }
}

function reportReservedRuntimeNames(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const declaration of AST.streamAllContents(file).filter(isRuntimeScopeNamedDeclaration)) {
    const name = Type.declarationName(declaration)
    if (name === '__proto__') {
      ctx.error(aliasValidationMessages.reservedName(name), declaration)
    }
  }
}

function isRuntimeScopeNamedDeclaration(node: AST.Node): node is NamedDeclaration {
  return AST.isActionDeclaration(node)
    || AST.isAliasDeclaration(node)
    || AST.isAppDeclaration(node)
    || AST.isForStatement(node)
    || AST.isAskStatement(node)
    || AST.isFunctionDeclaration(node)
    || AST.isParameterDeclaration(node)
    || AST.isEntityQueryDeclaration(node)
    || AST.isEnumCase(node)
    || AST.isEnumDeclaration(node)
    || AST.isVisualDeclaration(node)
    || AST.isStateDeclaration(node)
    || AST.isTypeDeclaration(node)
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
  if (AST.isConfiguredValue(alias.value) && AST.isUiDeclaration(declaration)) {
    return false
  }
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

function blocksOwnedByView(view: AST.VisualDeclaration): ViewOwnedBlock[] {
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
    if (AST.isWhenRenderStatement(statement)) {
      for (const branch of statement.branches) {
        collectRenderChildBlocks(branch.block, blocks)
      }
      collectRenderChildBlocks(statement.otherwise.block, blocks)
    }
    if (AST.isGuardRenderStatement(statement)) {
      const branches = statement.caseBlock?.branches ?? (statement.single ? [statement.single] : [])
      for (const branch of branches) {
        if (branch.block) {
          collectRenderChildBlocks(branch.block, blocks)
        }
      }
    }
    if (AST.isIfRenderStatement(statement)) {
      collectRenderChildBlocks(statement.block, blocks)
    }
    if (AST.isForStatement(statement)) {
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
    || AST.isFunctionDeclaration(node)
    || AST.isEnumDeclaration(node)
    || AST.isVisualDeclaration(node)
}
