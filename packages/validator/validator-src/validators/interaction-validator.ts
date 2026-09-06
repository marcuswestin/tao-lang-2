import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const bareInteractionConditions = ['pressed', 'focused', 'hovered'] as const
const editingShortcuts = new Set(['primary+a', 'primary+c', 'primary+v', 'primary+x', 'primary+z'])

const interactionValidationMessages = {
  condition: (condition: string) =>
    `Unknown interaction condition '${condition}'; expected when pressed, when focused, when hovered, when <region> is active, or when Scheme is Light|Dark.`,
  unknownRegion: (subject: string) =>
    `'when ${subject} is active' names no view or #tag visible from this file; a misspelt region is a condition that is never true.`,
  duplicateEntityPolicy: (entity: string, hidden: boolean) =>
    `Entity '${entity}' may declare '${hidden ? 'commands hide' : 'commands'}' only once.`,
  duplicateMention: (scope: string, command: string) => `${scope} references command '${command}' more than once.`,
  conflictingEntityMention: (entity: string, command: string) =>
    `Entity '${entity}' cannot both surface and hide command '${command}'.`,
  inapplicableEntityCommand: (entity: string, command: string) =>
    `Entity '${entity}' command '${command}' has no slot of type ${entity}.`,
  duplicateShortcut: (scope: string, shortcut: string, first: string, second: string) =>
    `${scope} gives shortcut '${shortcut}' to both '${first}' and '${second}'.`,
  editingShortcut: (command: string, shortcut: string) =>
    `Command '${command}' uses platform editing shortcut '${shortcut}'; editing controls take precedence while engaged.`,
  hidePlacement: '`hide <command>` is allowed only as a direct member of a view body.',
} as const

/** InteractionValidator owns static interaction vocabulary and command-surface diagnostics. */
export const InteractionValidator = {
  checks: {
    [AST.CommandDeclaration.$type]: validateCommandShortcut,
    [AST.DeclarationSlotFill.$type]: validateCommandSurface,
    [AST.EntityCommandPolicy.$type]: validateEntityCommandPolicy,
    [AST.LayoutCondition.$type]: validateInteractionCondition,
    [AST.ViewCommandExclusion.$type]: validateViewCommandExclusion,
  } satisfies NodeValidationChecks,
  messages: interactionValidationMessages,
}

function validateInteractionCondition(condition: AST.LayoutCondition, ctx: ValidationContext): void {
  const subject = String(ASTUtils.layoutTermValue(condition.subject))
  const value = condition.value && String(ASTUtils.layoutTermValue(condition.value))
  const bare = value === undefined && bareInteractionConditions.includes(
    subject as typeof bareInteractionConditions[number],
  )
  const active = value === 'active' && isPlainWord(condition.subject)
  const scheme = subject === 'Scheme' && (value === 'Light' || value === 'Dark')
  if (!bare && !active && !scheme) {
    ctx.error(interactionValidationMessages.condition(conditionText(condition)), condition)
    return
  }
  // The runtime resolves the subject against the regions an occurrence renders. It is the one word in
  // this vocabulary that is not a cross-reference, so it is checked here against the views and tags
  // this file can see; otherwise a typo is a style that silently never applies.
  if (active && !regionSubjectKnown(subject, condition)) {
    ctx.error(interactionValidationMessages.unknownRegion(subject), condition)
  }
}

function regionSubjectKnown(subject: string, condition: AST.LayoutCondition): boolean {
  const file = AST.getDocument(condition).parseResult.value
  const declared = file.statements.filter(AST.isViewDeclaration).some(view => view.name === subject)
  const imported = file.statements.filter(AST.isUseStatement).some(statement =>
    statement.importedDeclarations.some(reference => reference.$refText === subject)
  )
  const tagged = [...AST.streamAllContents(file)].filter(AST.isTagStatement).some(tag => tag.tag === `#${subject}`)
  return declared || imported || tagged
}

function isPlainWord(word: AST.LayoutWord): boolean {
  return word.suffixes.length === 0 && word.pathSegments.length === 0
}

function conditionText(condition: AST.LayoutCondition): string {
  const subject = String(ASTUtils.layoutTermValue(condition.subject))
  return condition.value === undefined
    ? `when ${subject}`
    : `when ${subject} is ${String(ASTUtils.layoutTermValue(condition.value))}`
}

function validateEntityCommandPolicy(policy: AST.EntityCommandPolicy, ctx: ValidationContext): void {
  const entity = policy.$container.$container
  const matching = AST.entityCommandPoliciesOf(entity).filter(candidate => candidate.hide === policy.hide)
  if (matching.indexOf(policy) > 0) {
    ctx.error(interactionValidationMessages.duplicateEntityPolicy(entity.singularName, policy.hide), policy)
  }
  validateDistinctMentions(policy.commands, `Entity '${entity.singularName}' commands`, policy, ctx)
  for (const reference of policy.commands) {
    const command = reference.ref
    if (!AST.isCommandDeclaration(command)) {
      continue
    }
    const applicable = ASTUtils.commandSlots(command).some(slot =>
      slot.type.kind === 'entity' && slot.type.entity === entity
    )
    if (!applicable) {
      ctx.error(interactionValidationMessages.inapplicableEntityCommand(entity.singularName, command.name), policy)
    }
  }

  const defaults = AST.entityCommandPoliciesOf(entity)
    .filter(candidate => !candidate.hide)
    .flatMap(candidate => candidate.commands.map(reference => reference.ref).filter(AST.isCommandDeclaration))
  const hidden = AST.entityCommandPoliciesOf(entity)
    .filter(candidate => candidate.hide)
    .flatMap(candidate => candidate.commands.map(reference => reference.ref).filter(AST.isCommandDeclaration))
  for (const command of hidden) {
    if (defaults.includes(command) && policy.hide && policy.commands.some(reference => reference.ref === command)) {
      ctx.error(interactionValidationMessages.conflictingEntityMention(entity.singularName, command.name), policy)
    }
  }
  if (!policy.hide && matching[0] === policy) {
    validateDistinctShortcuts(defaults, `Entity '${entity.singularName}' commands`, policy, ctx)
  }
}

function validateViewCommandExclusion(exclusion: AST.ViewCommandExclusion, ctx: ValidationContext): void {
  const block = exclusion.$container
  const direct = AST.isBlock(block)
    && AST.isViewDeclaration(block.$container)
    && block.$container.block === block
  if (!direct) {
    ctx.error(interactionValidationMessages.hidePlacement, exclusion)
  }
  validateDistinctMentions(exclusion.commands, 'View hide list', exclusion, ctx)
}

function validateCommandSurface(fill: AST.DeclarationSlotFill, ctx: ValidationContext): void {
  if ((fill.name !== 'Toolbar' && fill.name !== 'Commands') || !fill.block) {
    return
  }
  const commands = fill.block.references.map(reference => reference.ref).filter(AST.isCommandDeclaration)
  validateDistinctShortcuts(commands, fill.name, fill, ctx)
}

function validateCommandShortcut(command: AST.CommandDeclaration, ctx: ValidationContext): void {
  const shortcut = ASTUtils.commandStaticShortcut(command)
  if (shortcut && editingShortcuts.has(shortcut)) {
    const key = AST.commandFillsOf(command).find(fill => fill.name === 'Key')
    ctx.warning(interactionValidationMessages.editingShortcut(command.name, shortcut), key ?? command)
  }
  if (!shortcut) {
    return
  }
  const container = command.$container
  if (
    AST.isBlock(container)
    && AST.isViewDeclaration(container.$container)
    && container.$container.block === container
  ) {
    const commands = container.statements.filter(AST.isCommandDeclaration)
    validatePreviousShortcut(command, commands, `View '${container.$container.name}' commands`, ctx)
    return
  }
  if (!AST.isTaoFile(container) || hasEntitySlot(command)) {
    return
  }
  const globals = ctx.workspaceFiles.flatMap(file => file.statements.filter(AST.isCommandDeclaration))
    .filter(candidate => !hasEntitySlot(candidate))
  validatePreviousShortcut(command, globals, 'Global commands', ctx)
}

function validatePreviousShortcut(
  command: AST.CommandDeclaration,
  commands: readonly AST.CommandDeclaration[],
  scope: string,
  ctx: ValidationContext,
): void {
  const shortcut = ASTUtils.commandStaticShortcut(command)
  if (!shortcut) {
    return
  }
  const index = commands.indexOf(command)
  const first = commands.slice(0, index).find(candidate => ASTUtils.commandStaticShortcut(candidate) === shortcut)
  if (first) {
    ctx.error(
      interactionValidationMessages.duplicateShortcut(scope, shortcut, first.name, command.name),
      command,
    )
  }
}

function hasEntitySlot(command: AST.CommandDeclaration): boolean {
  return ASTUtils.commandSlots(command).some(slot => slot.type.kind === 'entity')
}

function validateDistinctMentions(
  references: readonly { readonly $refText: string; readonly ref?: AST.CommandDeclaration }[],
  scope: string,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const seen = new Set<string>()
  for (const reference of references) {
    const identity = reference.ref
      ? `${AST.getDocument(reference.ref).uri.path}#${reference.ref.name}`
      : reference.$refText
    if (seen.has(identity)) {
      ctx.error(interactionValidationMessages.duplicateMention(scope, reference.$refText), node)
      return
    }
    seen.add(identity)
  }
}

function validateDistinctShortcuts(
  commands: readonly AST.CommandDeclaration[],
  scope: string,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const byShortcut = new Map<string, AST.CommandDeclaration>()
  for (const command of new Set(commands)) {
    const shortcut = ASTUtils.commandStaticShortcut(command)
    if (!shortcut) {
      continue
    }
    const first = byShortcut.get(shortcut)
    if (first) {
      ctx.error(interactionValidationMessages.duplicateShortcut(scope, shortcut, first.name, command.name), node)
      return
    }
    byShortcut.set(shortcut, command)
  }
}
