import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { reportActionBindingDiagnostic } from './ActionsValidator'

const metadataTypes = {
  Label: { kind: 'primitive', primitive: 'text' },
  Icon: { kind: 'primitive', primitive: 'text' },
  Key: { kind: 'primitive', primitive: 'text' },
  Enabled: { kind: 'primitive', primitive: 'boolean' },
} as const satisfies Record<string, ASTUtils.TaoType>

export const commandValidationMessages = {
  placement: 'Commands are allowed only as direct members of a view body.',
  metadata: (name: string) => `Command metadata '${name}' is unknown; expected Label, Icon, Key, or Enabled.`,
  duplicateMetadata: (name: string) => `Command metadata '${name}' is filled more than once.`,
  metadataBlock: (name: string) => `Command metadata '${name}' expects a value expression.`,
  metadataType: (name: string, expected: string, actual: string) =>
    `Command metadata '${name}' expects ${expected}, got ${actual}.`,
  intentTitle: (name: string) => `Action '${name}' must fill Title before it can be bound as a command.`,
} as const

export const commandValidationChecks = {
  [AST.CommandDeclaration.$type]: validateCommand,
} satisfies NodeValidationChecks

function validateCommand(command: AST.CommandDeclaration, ctx: ValidationContext): void {
  if (!AST.commandOwningView(command)) {
    ctx.error(commandValidationMessages.placement, command)
  }
  const action = command.action.ref
  if (action) {
    if (!AST.declarationSlotFillNamed(action, 'Title')) {
      ctx.error(commandValidationMessages.intentTitle(action.name), command)
    }
    const resolved = ASTUtils.resolveArgumentBindings(action, command)
    for (const diagnostic of resolved.diagnostics) {
      reportActionBindingDiagnostic(action, diagnostic, command, ctx)
    }
  }
  validateMetadata(command, ctx)
}

function validateMetadata(command: AST.CommandDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const fill of command.metadata?.fills ?? []) {
    const expected = metadataTypes[fill.name as keyof typeof metadataTypes]
    if (!expected) {
      ctx.error(commandValidationMessages.metadata(fill.name), fill)
      continue
    }
    if (seen.has(fill.name)) {
      ctx.error(commandValidationMessages.duplicateMetadata(fill.name), fill)
    }
    seen.add(fill.name)
    if (fill.block) {
      ctx.error(commandValidationMessages.metadataBlock(fill.name), fill.block)
      continue
    }
    if (!fill.value) {
      continue
    }
    const actual = Type.ofExpression(fill.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        commandValidationMessages.metadataType(
          fill.name,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
        fill.value,
      )
    }
  }
}
