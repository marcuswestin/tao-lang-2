import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { primitiveSlots } from './workspace-index'

export const declarationSlotValidationMessages = {
  placement: 'Supplied slots are allowed only as direct members of a view or named action body.',
  unknown: (kind: string, name: string) => `${kind} has no supplied slot named '${name}'.`,
  duplicate: (kind: string, name: string) => `${kind} fills supplied slot '${name}' more than once.`,
  scalar: (name: string) => `Supplied slot '${name}' expects a value expression, not a command block.`,
  commandBlock: (name: string) => `Supplied slot '${name}' expects a command reference block.`,
  type: (name: string, expected: string, actual: string) =>
    `Supplied slot '${name}' expects ${expected}, got ${actual}.`,
  foreignCommand: (name: string, surface = 'Toolbar') => `${surface} entry '${name}' must be a command.`,
  duplicateCommand: (name: string, surface = 'Toolbar') => `${surface} references command '${name}' more than once.`,
  unfilledCommand: (name: string, slot: string, owner: string, surface = 'Toolbar') =>
    `${surface} command '${name}' needs a value for slot '${slot}', and ${owner} has no single parameter of that type to supply it.`,
} as const

export const declarationSlotValidationChecks = {
  [AST.DeclarationSlotFill.$type]: validateDeclarationSlotFill,
} satisfies NodeValidationChecks

function validateDeclarationSlotFill(fill: AST.DeclarationSlotFill, ctx: ValidationContext): void {
  const owner = directDeclarationOwner(fill)
  if (!owner) {
    ctx.error(fill, declarationSlotValidationMessages.placement)
    return
  }
  const kind = AST.isViewDeclaration(owner) ? (owner.scene ? 'scene' : 'view') : 'action'
  const contract = primitiveSlots(ctx, kind)
  const property = contract.find(candidate => candidate.name === fill.name)
  if (!property) {
    ctx.error(fill, declarationSlotValidationMessages.unknown(kind, fill.name))
    return
  }
  const fills = AST.declarationSlotFillsOf(owner)
  if (fills.find(candidate => candidate.name === fill.name) !== fill) {
    ctx.error(fill, declarationSlotValidationMessages.duplicate(kind, fill.name))
  }

  const expected = Type.ofProperty(property)
  const commandList = expected.kind === 'list'
    && expected.element?.kind === 'primitive'
    && expected.element.primitive === 'command'
  if (fill.block) {
    if (!commandList) {
      ctx.error(fill.block, declarationSlotValidationMessages.scalar(fill.name))
      return
    }
    validateCommandReferences(fill.block, ctx)
    return
  }
  if (!fill.value) {
    return
  }
  if (commandList) {
    ctx.error(fill.value, declarationSlotValidationMessages.commandBlock(fill.name))
    return
  }
  const actual = Type.ofExpression(fill.value)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    const expectedDisplay = property.type ? Type.ofReference(property.type) : expected
    ctx.error(
      fill.value,
      declarationSlotValidationMessages.type(
        fill.name,
        Type.displayName(expectedDisplay),
        Type.displayName(actual),
      ),
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

/**
 * A toolbar lists commands. A mention is deliberately unfilled — it names the verb, and the surface
 * supplies the noun from the scene it is already presenting, matched by type (KEY-D10). A slot the
 * scene cannot supply unambiguously is the one a host could not offer, and is reported here.
 */
function validateCommandReferences(block: AST.DeclarationSlotReferenceBlock, ctx: ValidationContext): void {
  const surface = AST.isDeclarationSlotFill(block.$container) ? block.$container.name : 'Toolbar'
  const seen = new Set<AST.CommandDeclaration>()
  const seenNames = new Set<string>()
  for (const reference of block.references) {
    const command = reference.ref
    const name = reference.$refText
    if (command && !AST.isCommandDeclaration(command)) {
      ctx.error(block, declarationSlotValidationMessages.foreignCommand(name, surface))
      continue
    }
    if ((command && seen.has(command)) || (!command && seenNames.has(name))) {
      ctx.error(block, declarationSlotValidationMessages.duplicateCommand(name, surface))
    }
    if (command) {
      seen.add(command)
      const owner = AST.findOwningView(block)
      const unresolved = owner ? ASTUtils.mentionFills(command, owner).unresolved : ASTUtils.commandSlots(command)
      const slot = unresolved[0]
      if (slot) {
        ctx.error(
          block,
          declarationSlotValidationMessages.unfilledCommand(
            command.name,
            slot.name,
            owner?.name ?? 'the surface',
            surface,
          ),
        )
      }
    }
    seenNames.add(name)
  }
}
