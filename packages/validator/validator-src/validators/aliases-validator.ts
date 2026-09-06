import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { DeclarationOrder, type ValueReferenceLike } from '../DeclarationOrder'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

type NamedValueDeclaration =
  | NamedFileValueDeclaration
  | AST.ParameterDeclaration
  | AST.StateDeclaration
  | AST.EntityQueryDeclaration
  | AST.CommandDeclaration
  | AST.ForStatement
  | AST.AskStatement
  | AST.CasePayload
  | AST.CaseSetCase
type NamedFileValueDeclaration =
  | AST.ActionDeclaration
  | AST.AliasDeclaration
  | AST.AppDeclaration
  | AST.NavDeclaration
  | AST.DatasourceDeclaration
  | AST.FixtureDeclaration
  | AST.FunctionDeclaration
  | AST.ViewDeclaration
type NamedTypeDeclaration = AST.PrimitiveDeclaration | AST.TypeDeclaration | AST.ConfigurableDeclaration
type NamedDeclaration = NamedValueDeclaration | NamedTypeDeclaration

/** aliasValidationMessages declares name and immutable-binding reference diagnostics. */
const aliasValidationMessages = {
  duplicateName: (name: string) => `Duplicate name '${name}'.`,
  reservedName: (name: string) => `Name '${name}' is reserved by Tao's generated runtime scope.`,
  aliasUsedBeforeDeclaration: (binding: string, value: string) =>
    `Binding '${binding}' cannot reference '${value}' because it is not declared before the binding.`,
  ascriptionType: (name: string, expected: string, actual: string) =>
    `Binding '${name}' is declared as ${expected}, but its value is ${actual}.`,
  usedBeforeDeclaration: (name: string) => `Name '${name}' is used before it is declared.`,
} as const

/** AliasesValidator validates immutable binding names and declaration order. */
export const AliasesValidator = {
  checks: {
    [AST.ActionDeclaration.$type]: reportReservedRuntimeName,
    [AST.CommandDeclaration.$type]: reportReservedRuntimeName,
    [AST.AliasDeclaration.$type]: [reportReservedRuntimeName, reportAliasAscription, reportAliasReferenceOrder],
    [AST.AppDeclaration.$type]: reportReservedRuntimeName,
    [AST.NavDeclaration.$type]: reportReservedRuntimeName,
    [AST.DatasourceDeclaration.$type]: reportReservedRuntimeName,
    [AST.ForStatement.$type]: reportReservedRuntimeName,
    [AST.AskStatement.$type]: reportReservedRuntimeName,
    [AST.FunctionDeclaration.$type]: reportReservedRuntimeName,
    [AST.ParameterDeclaration.$type]: reportReservedRuntimeName,
    [AST.EntityQueryDeclaration.$type]: reportReservedRuntimeName,
    [AST.CaseSetCase.$type]: reportReservedRuntimeName,
    [AST.ViewDeclaration.$type]: [reportReservedRuntimeName, validateViewDeclaration],
    [AST.StateDeclaration.$type]: reportReservedRuntimeName,
    [AST.TypeDeclaration.$type]: reportReservedRuntimeName,
    [AST.ValueReference.$type]: reportLocalValueReferenceOrder,
    [AST.MemberAccessExpression.$type]: reportLocalValueReferenceOrder,
  } satisfies NodeValidationChecks,
  messages: aliasValidationMessages,
  validateFile,
}

/** validateFile validates file-level duplicate names. */
function validateFile(file: AST.TaoFile, ctx: ValidationContext): void {
  const fileValueDeclarations: NamedValueDeclaration[] = [
    ...file.statements.filter(isFileValueDeclaration),
    ...file.statements.filter(AST.isTypeDeclaration).flatMap(AST.caseSetCasesOf),
  ]
  const fileTypeDeclarations = file.statements
    .filter(AST.isDeclaration)
    .filter((declaration): declaration is NamedTypeDeclaration => AST.declarationNamespace(declaration) === 'type')
  reportDuplicateNames(fileValueDeclarations, new Map(), ctx)
  reportDuplicateNames(fileTypeDeclarations, new Map(), ctx)
}

function validateViewDeclaration(view: AST.ViewDeclaration, ctx: ValidationContext, file: AST.TaoFile): void {
  const fileRenderables = file.statements.filter(AST.isViewDeclaration)
  const parameters = AST.parametersOf(view)
  reportNameConflicts(parameters, visibleDeclarations(fileRenderables), ctx)
  for (const block of blocksOwnedByView(view)) {
    const blockNames = visibleDeclarations([...fileRenderables, ...parameters])
    reportDuplicateNames(AST.valueDeclarationsOwnedByBlock(block), blockNames, ctx)
  }
}

function reportReservedRuntimeName(declaration: NamedDeclaration, ctx: ValidationContext): void {
  const name = Type.declarationName(declaration)
  if (name === '__proto__') {
    ctx.error(declaration, aliasValidationMessages.reservedName(name))
  }
}

function reportAliasAscription(alias: AST.AliasDeclaration, ctx: ValidationContext): void {
  if (!alias.type) {
    return
  }
  const expected = Type.ofReference(alias.type)
  const actual = Type.ofExpression(alias.value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved' || Type.isAssignable(actual, expected)) {
    return
  }
  ctx.error(
    alias.value,
    aliasValidationMessages.ascriptionType(
      alias.name,
      Type.displayName(expected),
      Type.displayName(actual),
    ),
  )
}

function reportDuplicateNames(
  declarations: readonly NamedDeclaration[],
  visible: Map<string, NamedDeclaration>,
  ctx: ValidationContext,
): void {
  for (const declaration of declarations) {
    const name = Type.declarationName(declaration)
    if (visible.has(name)) {
      ctx.error(declaration, aliasValidationMessages.duplicateName(name))
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
      ctx.error(declaration, aliasValidationMessages.duplicateName(name))
    }
  }
}

function visibleDeclarations(declarations: readonly NamedDeclaration[]): Map<string, NamedDeclaration> {
  return new Map(declarations.map(declaration => [Type.declarationName(declaration), declaration] as const))
}

function reportAliasReferenceOrder(alias: AST.AliasDeclaration, ctx: ValidationContext): void {
  for (const reference of aliasValueReferences(alias)) {
    if (AST.findOwningFromExpression(reference)) {
      continue
    }
    const target = reference.target.ref
    if (AST.isValueDeclaration(target) && isInvalidAliasInitializerReferenceOrder(target, reference, alias)) {
      ctx.error(
        reference,
        aliasValidationMessages.aliasUsedBeforeDeclaration(alias.name, Type.declarationName(target)),
      )
    }
  }
}

function reportLocalValueReferenceOrder(reference: ValueReferenceLike, ctx: ValidationContext): void {
  if (isReferenceInAliasOrStateInitializer(reference)) {
    return
  }
  const target = reference.target.ref
  if (AST.isValueDeclaration(target) && isInvalidLocalValueReferenceOrder(target, reference)) {
    ctx.error(reference, aliasValidationMessages.usedBeforeDeclaration(Type.declarationName(target)))
  }
}

function aliasValueReferences(alias: AST.AliasDeclaration): ValueReferenceLike[] {
  if (
    AST.isValueReference(alias.value)
    || AST.isRefinementExpression(alias.value)
    || AST.isMemberAccessExpression(alias.value)
  ) {
    return [alias.value]
  }
  return AST.streamAllContents(alias.value).filter(DeclarationOrder.isValueReferenceLike)
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
  if (AST.isConfiguredValue(alias.value) && AST.isViewDeclaration(declaration)) {
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

function blocksOwnedByView(view: AST.ViewDeclaration): ViewOwnedBlock[] {
  const blocks: ViewOwnedBlock[] = []
  if (view.block) {
    collectRenderChildBlocks(view.block, blocks)
  }
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
      for (const branch of ASTUtils.guardBranches(statement)) {
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

function isFileValueDeclaration(node: AST.Node): node is NamedFileValueDeclaration {
  return AST.isActionDeclaration(node)
    || AST.isAliasDeclaration(node)
    || AST.isAppDeclaration(node)
    || AST.isNavDeclaration(node)
    || AST.isDatasourceDeclaration(node)
    || AST.isFixtureDeclaration(node)
    || AST.isFunctionDeclaration(node)
    || AST.isViewDeclaration(node)
}
