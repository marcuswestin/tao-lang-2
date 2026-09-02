import { AST } from '@parser'
import { Type } from './Type'
import type { TaoType } from './Type'

/**
 * CommandSlot is one slot a command still needs before it can be invoked. A command's slots are its
 * parameters, declared exactly as an action declares its own, so a slot is named and typed the way
 * a parameter is: `Document` takes its same-named type and `Track Song` renames a typed slot.
 */
export type CommandSlot = {
  name: string
  parameter: AST.ParameterDeclaration
  type: TaoType
  /** The name a catalog publishes for the slot's type, which is how a surface matches an entity. */
  typeName: string
}

/** commandSlots returns the slots a command declares, in parameter order. */
export function commandSlots(command: AST.CommandDeclaration): readonly CommandSlot[] {
  return AST.parametersOf(command).map(parameter => {
    const type = Type.ofParameter(parameter)
    return { name: Type.parameterName(parameter), parameter, type, typeName: Type.displayName(type) }
  })
}

/**
 * mentionFills resolves a command mentioned on a surface against the parameters of the declaration
 * that mentions it, matching each still-unfilled slot to a parameter by type (KEY-D10).
 *
 * A mention is deliberately unfilled: `Toolbar { Finish }` names the verb, and the surface supplies
 * the noun from what it is already presenting. Matching is by type and must be unambiguous — two
 * parameters of a slot's type mean the surface cannot choose, so the slot stays unresolved and the
 * validator reports it at the mention.
 */
export function mentionFills(
  command: AST.CommandDeclaration,
  owner: AST.ViewDeclaration,
): { readonly fills: ReadonlyMap<string, AST.ParameterDeclaration>; readonly unresolved: readonly CommandSlot[] } {
  const parameters = AST.parametersOf(owner)
  const fills = new Map<string, AST.ParameterDeclaration>()
  const unresolved: CommandSlot[] = []
  for (const slot of commandSlots(command)) {
    const matches = parameters.filter(parameter => Type.isAssignable(Type.ofValueDeclaration(parameter), slot.type))
    const only = matches.length === 1 ? matches[0] : undefined
    if (only) {
      fills.set(slot.name, only)
    } else {
      unresolved.push(slot)
    }
  }
  return { fills, unresolved }
}
