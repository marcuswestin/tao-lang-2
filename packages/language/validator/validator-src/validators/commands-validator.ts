import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { ActionsValidator, reportActionBindingDiagnostic } from './ActionsValidator'
import { ReactiveParametersValidator } from './ReactiveParametersValidator'
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
  shortcutDuplicateModifier: (modifier: string) => `Shortcut modifier '${modifier}' is repeated.`,
  shortcutModifier: (modifier: string) =>
    `Shortcut modifier '${modifier}' is not registered; Tao registers ${registeredShortcutModifiers.join(', ')}.`,
  shortcutPlatformModifier: (modifier: string) => `A shortcut names 'primary', never the platform key '${modifier}'.`,
  shortcutReserved: (shortcut: string) =>
    `Shortcut '${shortcut}' is owned by Tao's interaction reducer and cannot invoke a command.`,
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
      ctx.error(entry, commandValidationMessages.duplicateMember(name))
    }
    seen.add(name)
    if (name === 'Title') {
      ctx.error(entry, commandValidationMessages.titleOverride(command.name))
      continue
    }
    const slot = slots.get(name)
    if (slot) {
      reportSlotBinding(slot, entry, ctx)
      continue
    }
    const property = contract.find(candidate => candidate.name === name)
    if (!property) {
      ctx.error(entry, commandValidationMessages.unknownBinding(command.name, name))
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
    if (
      ASTUtils.parameterRequiresWritable(slot.parameter)
      && !ASTUtils.writableExpression(value)
    ) {
      ctx.error(entry, ReactiveParametersValidator.messages.readonlyArgument(slot.name))
    }
    return
  }
  ctx.error(
    entry,
    commandValidationMessages.memberType(slot.name, Type.displayName(slot.type), Type.displayName(actual)),
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
    ctx.error(command, commandValidationMessages.placement)
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
    ctx.error(command, commandValidationMessages.missingDo(command.name))
    return
  }
  for (const extra of clauses.slice(1)) {
    ctx.error(extra, commandValidationMessages.duplicateDo(command.name))
  }
  const target = ASTUtils.resolveActionTarget(clause.action)
  if (target.kind === 'named') {
    // A command runs an action, never another verb: a verb behind a verb would be two names for
    // one thing, and the catalog would list both.
    if (AST.isCommandDeclaration(target.action)) {
      ctx.error(clause.action, commandValidationMessages.doTarget(command.name))
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
      ctx.error(clause.action, commandValidationMessages.doTarget(command.name))
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
      ctx.error(fill, commandValidationMessages.member(fill.name, expected))
      continue
    }
    if (filled.has(fill.name)) {
      ctx.error(fill, commandValidationMessages.duplicateMember(fill.name))
    }
    filled.add(fill.name)
    if (fill.name === 'Title' && !AST.isStringLiteral(fill.value)) {
      const actual = Type.ofExpression(fill.value)
      if (
        actual.kind !== 'unresolved'
        && Type.isAssignable(actual, { kind: 'primitive', primitive: 'text' })
      ) {
        ctx.error(fill.value, commandValidationMessages.staticTitle(command.name))
      }
    }
    reportMemberValue(fill.name, property, fill.value, ctx)
  }
  if (!filled.has('Title')) {
    ctx.error(command, commandValidationMessages.missingTitle(command.name))
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
    value,
    commandValidationMessages.memberType(name, Type.displayName(expectedDisplay), Type.displayName(actual)),
  )
}

/**
 * A shortcut is a modifier chain ending in one key. Only literal chains can be checked here, which
 * is the whole vocabulary any current feature writes; a computed shortcut is checked by its type.
 */
function validateShortcut(value: AST.Expression, ctx: ValidationContext): void {
  const shortcut = ASTUtils.parseShortcut(value)
  if (!shortcut) {
    return
  }
  if (!shortcut.ok) {
    if (shortcut.reason === 'duplicate-modifier') {
      ctx.error(value, commandValidationMessages.shortcutDuplicateModifier(shortcut.duplicateModifier!))
      return
    }
    ctx.error(value, commandValidationMessages.shortcutKey)
    return
  }
  for (const modifier of shortcut.modifiers) {
    const normalized = modifier.toLowerCase()
    if (platformShortcutModifiers.includes(normalized)) {
      ctx.error(value, commandValidationMessages.shortcutPlatformModifier(modifier))
      continue
    }
    if (!registeredShortcutModifiers.includes(normalized as typeof registeredShortcutModifiers[number])) {
      ctx.error(value, commandValidationMessages.shortcutModifier(modifier))
    }
  }
  if (ASTUtils.reservedCommandShortcuts.has(shortcut.canonical)) {
    ctx.error(value, commandValidationMessages.shortcutReserved(shortcut.canonical))
  }
}
