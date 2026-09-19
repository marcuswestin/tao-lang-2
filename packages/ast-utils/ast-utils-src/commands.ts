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

export type ParsedShortcut =
  | Readonly<{
    canonical: string
    key: string
    modifiers: readonly string[]
    ok: true
  }>
  | Readonly<{
    duplicateModifier?: string
    ok: false
    reason: 'duplicate-modifier' | 'key' | 'missing-key'
  }>

const shortcutNamedKeys: Readonly<Record<string, string>> = Object.freeze({
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  backspace: 'Backspace',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
})

/** Reducer-owned keys are valid physical keys but can never dispatch an authored command. */
export const reservedCommandShortcuts: ReadonlySet<string> = new Set([
  'arrowdown',
  'arrowleft',
  'arrowright',
  'arrowup',
  'backspace',
  'enter',
  'escape',
  'space',
  'tab',
  '.',
  '/',
  '?',
  'primary+k',
])

/** commandSlots returns the slots a command declares, in parameter order. */
export function commandSlots(command: AST.CommandDeclaration): readonly CommandSlot[] {
  return AST.parametersOf(command).map(parameter => {
    const type = Type.ofParameter(parameter)
    return { name: Type.parameterName(parameter), parameter, type, typeName: Type.displayName(type) }
  })
}

/** commandStaticMemberText reads a literal command member without evaluating reactive Tao code. */
export function commandStaticMemberText(command: AST.CommandDeclaration, name: string): string | undefined {
  const value = AST.commandFillsOf(command).find(fill => fill.name === name)?.value
  return value && AST.isStringLiteral(value) ? unquoted(value.value) : undefined
}

/** commandStaticShortcut reads the normalized literal shortcut a static scope can compare. */
export function commandStaticShortcut(command: AST.CommandDeclaration): string | undefined {
  const value = AST.commandFillsOf(command).find(fill => fill.name === 'Key')?.value
  const shortcut = value ? parseShortcut(value) : undefined
  return shortcut?.ok ? shortcut.canonical : undefined
}

/** parseShortcut is the one static shortcut parser shared by validation and command indexing. */
export function parseShortcut(value: AST.Expression): ParsedShortcut | undefined {
  const text = literalShortcutText(value)
  if (text === undefined) {
    return undefined
  }
  if (text === ' ') {
    return { canonical: 'space', key: 'Space', modifiers: [], ok: true }
  }
  const segments = text.split('+').map(segment => segment.trim())
  const rawKey = segments.at(-1)
  if (rawKey === undefined || rawKey.length === 0 || segments.slice(0, -1).some(segment => segment.length === 0)) {
    return { ok: false, reason: 'missing-key' }
  }
  const modifiers = segments.slice(0, -1).map(modifier => modifier.toLowerCase())
  const duplicateModifier = modifiers.find((modifier, index) => modifiers.indexOf(modifier) !== index)
  if (duplicateModifier !== undefined) {
    return { duplicateModifier, ok: false, reason: 'duplicate-modifier' }
  }
  const named = shortcutNamedKeys[rawKey.toLowerCase()]
  const key = named ?? ([...rawKey].length === 1 ? rawKey.toLowerCase() : undefined)
  if (key === undefined) {
    return { ok: false, reason: 'key' }
  }
  return {
    canonical: [...modifiers, key].join('+').toLowerCase(),
    key,
    modifiers: Object.freeze(modifiers),
    ok: true,
  }
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

/** literalShortcutText resolves the source forms whose shortcut is known before runtime. */
function literalShortcutText(value: AST.Expression): string | undefined {
  if (AST.isStringLiteral(value)) {
    return unquoted(value.value)
  }
  if (AST.isValueReference(value)) {
    const target = value.target.ref
    return AST.isAliasDeclaration(target) && AST.isExpression(target.value)
      ? literalShortcutText(target.value)
      : undefined
  }
  if (AST.isBinaryExpression(value) && value.operator === '+') {
    const left = literalShortcutText(value.left)
    const right = literalShortcutText(value.right)
    return left === undefined || right === undefined ? undefined : `${left}${right}`
  }
  return undefined
}

function unquoted(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}
