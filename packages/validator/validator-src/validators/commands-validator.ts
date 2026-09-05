import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { ActionsValidator, reportActionBindingDiagnostic } from './ActionsValidator'
import { primitiveSlots } from './workspace-index'

/**
 * The one registered shortcut modifier. `primary` is the platform's own chord key, which is the
 * whole reason a Tao shortcut never names a platform key itself. Later tranches register more when
 * a journey forces them.
 */
const registeredShortcutModifiers = ['primary'] as const

/** Modifiers that name a platform key. They are recognized only so the rule can be said out loud. */
const platformShortcutModifiers = ['cmd', 'command', 'ctrl', 'control', 'meta', 'win', 'super']

export const commandValidationMessages = {
  placement: 'Commands are allowed at module level or as direct members of a view body.',
  missingDo: (name: string) => `Command '${name}' must name the action it runs with one 'do' clause.`,
  duplicateDo: (name: string) => `Command '${name}' names more than one 'do' clause.`,
  doTarget: (name: string) => `Command '${name}' must run an action.`,
  member: (name: string, expected: string) => `Command has no member named '${name}'; expected ${expected}.`,
  duplicateMember: (name: string) => `Command member '${name}' is filled more than once.`,
  memberType: (name: string, expected: string, actual: string) =>
    `Command member '${name}' expects ${expected}, got ${actual}.`,
  missingTitle: (name: string) => `Command '${name}' must fill Title.`,
  staticTitle: (name: string) => `Command '${name}' must fill Title with a static text literal.`,
  titleOverride: (name: string) => `Command '${name}' may not override Title.`,
  unknownBinding: (name: string, slot: string) => `Command '${name}' has no slot or member named '${slot}'.`,
  shortcutKey: 'A shortcut needs one key after its modifiers.',
  shortcutModifier: (modifier: string) =>
    `Shortcut modifier '${modifier}' is not registered; Tao registers ${registeredShortcutModifiers.join(', ')}.`,
  shortcutPlatformModifier: (modifier: string) => `A shortcut names 'primary', never the platform key '${modifier}'.`,
} as const

/**
 * A command's invocation, `do Finish(Document)`, is not checked here: it is an action invocation
 * whose parameters are the command's slots, and `ActionsValidator` reports its arity and types.
 */
export const commandValidationChecks = {
  [AST.CommandDeclaration.$type]: validateCommand,
} satisfies NodeValidationChecks

/**
 * Binding a command is derivation: it fills the slots the declaration left open and may refine the
 * words a host shows. `Title` is the one member it may not touch — the title is what identifies the
 * verb wherever it is listed, so a binding that renamed it would name a second verb.
 */
export function validateCommandBinding(
  command: AST.CommandDeclaration,
  block: AST.ConfigurationBlock,
  ctx: ValidationContext,
): void {
  const contract = commandMemberContract(ctx)
  const slots = new Map(ASTUtils.commandSlots(command).map(slot => [slot.name, slot]))
  const seen = new Set<string>()
  for (const entry of block.entries) {
    const name = AST.configurationEntryName(entry)
    if (name === undefined) {
      continue
    }
    if (seen.has(name)) {
      ctx.error(commandValidationMessages.duplicateMember(name), entry)
    }
    seen.add(name)
    if (name === 'Title') {
      ctx.error(commandValidationMessages.titleOverride(command.name), entry)
      continue
    }
    const slot = slots.get(name)
    if (slot) {
      reportSlotBinding(slot, entry, ctx)
      continue
    }
    const property = contract.find(candidate => candidate.name === name)
    if (!property) {
      ctx.error(commandValidationMessages.unknownBinding(command.name, name), entry)
      continue
    }
    const value = bindingValue(entry)
    if (value) {
      reportMemberValue(name, property, value, ctx)
    }
  }
}

function reportSlotBinding(
  slot: ASTUtils.CommandSlot,
  entry: AST.ConfigurationEntry,
  ctx: ValidationContext,
): void {
  const value = bindingValue(entry)
  if (!value) {
    return
  }
  const actual = Type.ofExpression(value)
  if (slot.type.kind === 'unresolved' || actual.kind === 'unresolved' || Type.isAssignable(actual, slot.type)) {
    return
  }
  ctx.error(
    commandValidationMessages.memberType(slot.name, Type.displayName(slot.type), Type.displayName(actual)),
    entry,
  )
}

/** bindingValue reads the expression one configuration entry supplies, whatever spelling it used. */
function bindingValue(entry: AST.ConfigurationEntry): AST.Expression | undefined {
  if (entry.expression) {
    return entry.expression
  }
  return entry.value && AST.isExpression(entry.value) ? entry.value : undefined
}

function validateCommand(command: AST.CommandDeclaration, ctx: ValidationContext): void {
  if (!commandIsWellPlaced(command)) {
    ctx.error(commandValidationMessages.placement, command)
  }
  // Slots are parameters, so the ordinary parameter rules cover them: a name declared twice, or one
  // that shadows a value the command can already see.
  ActionsValidator.validateParameters(command, ctx)
  validateDoClauses(command, ctx)
  validateMembers(command, ctx)
}

/** commandMemberContract returns the member vocabulary the Prelude declares for a command. */
function commandMemberContract(ctx: ValidationContext): readonly AST.TypeProperty[] {
  return primitiveSlots(ctx, 'command')
}

/** commandIsWellPlaced accepts the two homes a command has: a module, or one view body. */
function commandIsWellPlaced(command: AST.CommandDeclaration): boolean {
  return AST.isTaoFile(command.$container) || AST.commandOwningView(command) !== undefined
}

function validateDoClauses(command: AST.CommandDeclaration, ctx: ValidationContext): void {
  const clauses = AST.commandDoClausesOf(command)
  const clause = clauses[0]
  if (!clause) {
    ctx.error(commandValidationMessages.missingDo(command.name), command)
    return
  }
  for (const extra of clauses.slice(1)) {
    ctx.error(commandValidationMessages.duplicateDo(command.name), extra)
  }
  const target = ASTUtils.resolveActionTarget(clause.action)
  if (target.kind === 'named') {
    // A command runs an action, never another verb: a verb behind a verb would be two names for
    // one thing, and the catalog would list both.
    if (AST.isCommandDeclaration(target.action)) {
      ctx.error(commandValidationMessages.doTarget(command.name), clause.action)
      return
    }
    const resolved = ASTUtils.resolveArgumentBindings(target.action, clause)
    for (const diagnostic of resolved.diagnostics) {
      reportActionBindingDiagnostic(target.action, diagnostic, clause, ctx)
    }
    return
  }
  if (target.kind === 'unresolved') {
    const type = Type.ofExpression(clause.action)
    if (type.kind !== 'unresolved') {
      ctx.error(commandValidationMessages.doTarget(command.name), clause.action)
    }
  }
}

function validateMembers(command: AST.CommandDeclaration, ctx: ValidationContext): void {
  const contract = commandMemberContract(ctx)
  const expected = contract.map(property => property.name).join(', ')
  const filled = new Set<string>()
  for (const fill of AST.commandFillsOf(command)) {
    const property = contract.find(candidate => candidate.name === fill.name)
    if (!property) {
      ctx.error(commandValidationMessages.member(fill.name, expected), fill)
      continue
    }
    if (filled.has(fill.name)) {
      ctx.error(commandValidationMessages.duplicateMember(fill.name), fill)
    }
    filled.add(fill.name)
    if (fill.name === 'Title' && !AST.isStringLiteral(fill.value)) {
      const actual = Type.ofExpression(fill.value)
      if (
        actual.kind !== 'unresolved'
        && Type.isAssignable(actual, { kind: 'primitive', primitive: 'text' })
      ) {
        ctx.error(commandValidationMessages.staticTitle(command.name), fill.value)
      }
    }
    reportMemberValue(fill.name, property, fill.value, ctx)
  }
  if (!filled.has('Title')) {
    ctx.error(commandValidationMessages.missingTitle(command.name), command)
  }
}

/** reportMemberValue type-checks one member fill against the Prelude's declared slot type. */
function reportMemberValue(
  name: string,
  property: AST.TypeProperty,
  value: AST.Expression,
  ctx: ValidationContext,
): void {
  // A member whose declared default is `none` (Prelude's `Key shortcut is none`) accepts `none`.
  if (AST.isNoneLiteral(value) && !Type.propertyRequiresValue(property)) {
    return
  }
  const expected = Type.ofProperty(property)
  if (expected.kind === 'primitive' && expected.primitive === 'shortcut') {
    validateShortcut(value, ctx)
  }
  const actual = Type.ofExpression(value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved' || Type.isAssignable(actual, expected)) {
    return
  }
  const expectedDisplay = property.type ? Type.ofReference(property.type) : expected
  ctx.error(
    commandValidationMessages.memberType(name, Type.displayName(expectedDisplay), Type.displayName(actual)),
    value,
  )
}

/**
 * A shortcut is a modifier chain ending in one key. Only literal chains can be checked here, which
 * is the whole vocabulary any current feature writes; a computed shortcut is checked by its type.
 */
function validateShortcut(value: AST.Expression, ctx: ValidationContext): void {
  const segments = shortcutSegments(value)
  if (!segments) {
    return
  }
  const key = segments.at(-1)
  if (key === undefined || key.length === 0) {
    ctx.error(commandValidationMessages.shortcutKey, value)
    return
  }
  for (const modifier of segments.slice(0, -1)) {
    const normalized = modifier.toLowerCase()
    if (platformShortcutModifiers.includes(normalized)) {
      ctx.error(commandValidationMessages.shortcutPlatformModifier(modifier), value)
      continue
    }
    if (!registeredShortcutModifiers.includes(normalized as typeof registeredShortcutModifiers[number])) {
      ctx.error(commandValidationMessages.shortcutModifier(modifier), value)
    }
  }
}

/** shortcutSegments reads a literal shortcut as its `+`-separated words, or nothing when computed. */
function shortcutSegments(value: AST.Expression): readonly string[] | undefined {
  const literal = literalShortcutText(value)
  return literal === undefined ? undefined : literal.split('+').map(segment => segment.trim())
}

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
    // A modifier carries its own separator, so the chain is a plain concatenation.
    return left === undefined || right === undefined ? undefined : `${left}${right}`
  }
  return undefined
}

function unquoted(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}
