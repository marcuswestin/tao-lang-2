import { AST } from '@parser'
import { Type } from './Type'
import type { TaoType } from './Type'

/**
 * A command body writes slots and fills in one shape, because juxtaposition already declares a
 * typed slot everywhere else in the language. A slot is a bare type name standing alone; every
 * other member carries a value. This module is the one place that decision is made.
 */
export type CommandMember =
  /** A slot the invocation still needs, named and typed by the type it names. */
  | { kind: 'slot'; entry: AST.CommandEntry; name: string; typeName: string; type: TaoType }
  /** A value for one member of `primitive command`. */
  | { kind: 'fill'; entry: AST.CommandEntry; name: string; value: AST.Expression }
  /** A bare name that reaches no type, so it declares nothing and fills nothing. */
  | { kind: 'valueless'; entry: AST.CommandEntry; name: string }

/** CommandSlot is one slot a command still needs before it can be invoked. */
export type CommandSlot = Extract<CommandMember, { kind: 'slot' }>

/** commandMembers classifies one command body's entries into slots, fills, and their diagnostics. */
export function commandMembers(command: AST.CommandDeclaration): readonly CommandMember[] {
  return AST.commandEntriesOf(command).map(classifyCommandEntry)
}

/** commandSlots returns only the slots a command declares, in source order. */
export function commandSlots(command: AST.CommandDeclaration): readonly CommandSlot[] {
  return commandMembers(command).filter(isCommandSlot)
}

function isCommandSlot(member: CommandMember): member is CommandSlot {
  return member.kind === 'slot'
}

function classifyCommandEntry(entry: AST.CommandEntry): CommandMember {
  const name = entry.name
  if (entry.value) {
    return { kind: 'fill', entry, name, value: entry.value }
  }
  return Type.namedTypeExists(entry, name)
    ? { kind: 'slot', entry, name, typeName: name, type: Type.ofNamedTypeName(entry, name) }
    : { kind: 'valueless', entry, name }
}

/** CommandBinding is one command value together with the fills written where it was bound. */
export type CommandBinding = {
  command: AST.CommandDeclaration
  block: AST.ConfigurationBlock | undefined
}

/** resolveCommandBinding reads a command value out of a reference or a `with` refinement of one. */
export function resolveCommandBinding(
  expression: AST.Expression | undefined,
): CommandBinding | undefined {
  if (AST.isValueReference(expression)) {
    const target = expression.target.ref
    return AST.isCommandDeclaration(target) ? { command: target, block: undefined } : undefined
  }
  if (AST.isRefinementExpression(expression)) {
    const target = expression.target.ref
    return AST.isCommandDeclaration(target) ? { command: target, block: expression.patchBlock } : undefined
  }
  return undefined
}

/** commandBindingEntryName returns the member or slot one configuration entry names. */
export function commandBindingEntryName(entry: AST.ConfigurationEntry): string | undefined {
  return entry.name ?? entry.label ?? entry.reference?.$refText
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
