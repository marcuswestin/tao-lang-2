import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from '../validation'

export const agentCommandsValidationMessages = {
  literal: 'AgentCommands must be a literal list of direct module command references.',
  command: 'AgentCommands entries must directly reference module-level commands.',
  slot: (command: string, slot: string) =>
    `AgentCommands command '${command}' slot '${slot}' must have type text, number, or boolean.`,
} as const

/** The app metadata list can name commands with different signatures. */
export function isAgentCommandsList(list: AST.ListLiteral): boolean {
  const property = list.$container
  if (AST.isAppProperty(property)) {
    return property.name === 'AgentCommands'
  }
  if (!AST.isConfigurationEntry(property) || property.name !== 'AgentCommands') {
    return false
  }
  const owner = property.$container.$container
  return AST.isExpression(owner)
    && Type.isAssignable(Type.ofExpression(owner), { kind: 'primitive', primitive: 'app' })
}

/** Only explicitly listed, module-owned commands with scalar inputs can cross the app bridge. */
export function validateAgentCommands(app: AST.AppValueDeclaration, ctx: ValidationContext): void {
  const property = ASTUtils.effectiveAppConfiguration(app).get('AgentCommands')
  if (!property) {
    return
  }
  const value = property.value
  if (property.block || property.patches.length > 0 || !AST.isListLiteral(value)) {
    ctx.error(property.block ?? property.patches[0] ?? value ?? app, agentCommandsValidationMessages.literal)
    return
  }
  for (const element of value.elements) {
    const command = AST.isValueReference(element) ? element.target.ref : undefined
    if (!AST.isCommandDeclaration(command) || !AST.isTaoFile(command.$container)) {
      ctx.error(element, agentCommandsValidationMessages.command)
      continue
    }
    for (const slot of ASTUtils.commandSlots(command)) {
      if (slot.type.kind !== 'primitive' || !['text', 'number', 'boolean'].includes(slot.type.primitive)) {
        ctx.error(element, agentCommandsValidationMessages.slot(command.name, slot.name))
      }
    }
  }
}
