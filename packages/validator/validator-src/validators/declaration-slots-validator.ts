import { Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const declarationSlotValidationMessages = {
  placement: 'Supplied slots are allowed only as direct members of a view or named action body.',
  unknown: (kind: string, name: string) => `${kind} has no supplied slot named '${name}'.`,
  duplicate: (kind: string, name: string) => `${kind} fills supplied slot '${name}' more than once.`,
  scalar: (name: string) => `Supplied slot '${name}' expects a value expression, not a command block.`,
  commandBlock: (name: string) => `Supplied slot '${name}' expects a command reference block.`,
  type: (name: string, expected: string, actual: string) =>
    `Supplied slot '${name}' expects ${expected}, got ${actual}.`,
  foreignCommand: (name: string) => `Toolbar command '${name}' must be declared directly in the same view.`,
  duplicateCommand: (name: string) => `Toolbar references command '${name}' more than once.`,
} as const

export const declarationSlotValidationChecks = {
  [AST.DeclarationSlotFill.$type]: validateDeclarationSlotFill,
} satisfies NodeValidationChecks

function validateDeclarationSlotFill(fill: AST.DeclarationSlotFill, ctx: ValidationContext): void {
  if (AST.isDeclarationSlotBlock(fill.$container)) {
    return
  }
  const owner = directDeclarationOwner(fill)
  if (!owner) {
    ctx.error(declarationSlotValidationMessages.placement, fill)
    return
  }
  const kind = AST.isViewDeclaration(owner) ? 'view' : 'action'
  const contract = AST.primitiveSlots(ctx.workspaceFiles, kind)
  const property = contract.find(candidate => candidate.name === fill.name)
  if (!property) {
    ctx.error(declarationSlotValidationMessages.unknown(kind, fill.name), fill)
    return
  }
  const fills = AST.declarationSlotFillsOf(owner)
  if (fills.find(candidate => candidate.name === fill.name) !== fill) {
    ctx.error(declarationSlotValidationMessages.duplicate(kind, fill.name), fill)
  }

  const expected = Type.ofProperty(property)
  const commandList = expected.kind === 'list'
    && expected.element?.kind === 'primitive'
    && expected.element.primitive === 'action'
  if (fill.block) {
    if (!commandList) {
      ctx.error(declarationSlotValidationMessages.scalar(fill.name), fill.block)
      return
    }
    validateCommandReferences(fill.block, ctx)
    return
  }
  if (!fill.value) {
    return
  }
  if (commandList) {
    ctx.error(declarationSlotValidationMessages.commandBlock(fill.name), fill.value)
    return
  }
  const actual = Type.ofExpression(fill.value)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    const expectedDisplay = property.type ? Type.ofReference(property.type) : expected
    ctx.error(
      declarationSlotValidationMessages.type(
        fill.name,
        Type.displayName(expectedDisplay),
        Type.displayName(actual),
      ),
      fill.value,
    )
  }
}

function directDeclarationOwner(
  fill: AST.DeclarationSlotFill,
): AST.ViewDeclaration | AST.ActionDeclaration | undefined {
  const block = fill.$container
  if (AST.isBlock(block) && AST.isViewDeclaration(block.$container) && block.$container.block === block) {
    return block.$container
  }
  if (
    AST.isActionBlock(block)
    && AST.isActionDeclaration(block.$container)
    && block.$container.block === block
  ) {
    return block.$container
  }
  return undefined
}

function validateCommandReferences(block: AST.DeclarationSlotReferenceBlock, ctx: ValidationContext): void {
  const view = AST.findOwningView(block)
  const localCommands = new Set(AST.isViewDeclaration(view) ? AST.commandsOf(view) : [])
  const seen = new Set<AST.CommandDeclaration>()
  const seenNames = new Set<string>()
  for (const reference of block.references) {
    const command = reference.ref
    const name = reference.$refText
    if (command && !localCommands.has(command)) {
      ctx.error(declarationSlotValidationMessages.foreignCommand(name), block)
    }
    if ((command && seen.has(command)) || (!command && seenNames.has(name))) {
      ctx.error(declarationSlotValidationMessages.duplicateCommand(name), block)
    }
    if (command) {
      seen.add(command)
    }
    seenNames.add(name)
  }
}
