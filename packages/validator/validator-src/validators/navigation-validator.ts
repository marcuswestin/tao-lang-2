import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { configuredValueValidationMessages } from './configured-values-validator'
import { sceneSuppressesHeader } from './views-validator'

/** navigationValidationMessages declares configured navigation diagnostics. */
export const navigationValidationMessages = {
  missingArgument: (destination: string, parameter: string) =>
    `Presentation of ${destination} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (destination: string) =>
    `Presentation of ${destination} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (destination: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Presentation of ${destination} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (destination: string, parameter: string) =>
    `Presentation of ${destination} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (destination: string, parameter: string) =>
    `Destination ${destination} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (destination: string) =>
    `Presentation of ${destination} has more than one argument with the same exact type.`,
  unknownNamedArgument: (destination: string, name: string) =>
    `Destination ${destination} has no parameter named '${name}'.`,
  duplicateNamedArgument: (destination: string, name: string) =>
    `Presentation of ${destination} provides parameter '${name}' more than once.`,
  nonRestorableArgument: (destination: string, parameter: string) =>
    `Presentation of ${destination} cannot be restored: parameter ${parameter} action does not serialize.`,
  namedArgumentType: (destination: string, name: string, expected: string, actual: string) =>
    `Labeled argument '${name}:' of destination ${destination} expects ${expected}, got ${actual}.`,
  presentationContext: 'Contextual presentation is allowed only inside a view declaration.',
  toastContext: 'Toast presentation is allowed only inside a view declaration.',
  toastTarget: 'Toast presentation is app-level and does not accept `in`.',
  toastKeyType: (actual: string) => `Toast Key expects text, got ${actual}.`,
  toastDurationType: (actual: string) => `Toast Duration expects duration, got ${actual}.`,
  toastDurationNegative: 'Toast Duration cannot be negative.',
  activationContext: 'Selection activation is allowed only inside a view declaration.',
  strictTargetDeclaration: (name: string) =>
    `Strict app target '${name}' must name an app declaration, not an app variant.`,
  unknownSelection: (app: string, key: string) => `App ${app} navigator has no selection item named '@${key}'.`,
  ...configuredValueValidationMessages,
  presentationTarget: (actual: string) => `Presentation target expects nav, got ${actual}.`,
  dismissContext: '`dismiss` is allowed only inside a view declaration.',
  replaceContext: '`replace` is allowed only inside a view declaration.',
  replaceNavigator: (actual: string) => `Replacement expects nav, got ${actual}.`,
  unknownAuxiliary: (app: string, key: string) => `App ${app} has no auxiliary navigator named '@${key}'.`,
  missingHostTitle: (view: string) =>
    `Scene '${view}' must fill Title when used as a statically known StackNav destination.`,
  missingNavHostTitle: (nav: string) =>
    `Navigation '${nav}' must configure Title when used as a statically known StackNav destination.`,
  unknownFrameSlot: (key: string) => `FrameNav has no slot '${key}'; its slots are ${frameNavSlotKeys.join(', ')}.`,
  frameCenterSize: "FrameNav slot '@center' has no Size: it fills whatever space the edges leave.",
} as const

/** The frame's declared slots. One @key template declares their shape; these are their names. */
const frameNavSlotKeys = ['@top', '@bottom', '@left', '@right', '@center'] as const

/** navigationValidationChecks validates configured navigation and presentation calls. */
export const navigationValidationChecks = {
  [AST.ContextualPresentStatement.$type]: validateContextualPresentation,
  [AST.ViewBinding.$type]: validateViewBinding,
  [AST.ConfigurationEntry.$type]: (entry, ctx) => {
    validateStackInitialTitle(entry, ctx)
    validateFrameSlot(entry, ctx)
  },
  [AST.DismissStatement.$type]: (dismiss, ctx) => {
    if (!AST.findOwningView(dismiss)) {
      ctx.error(navigationValidationMessages.dismissContext, dismiss)
    }
  },
  [AST.SelectionActivateStatement.$type]: (activation, ctx, file) => {
    if (!AST.findOwningView(activation)) {
      ctx.error(navigationValidationMessages.activationContext, activation)
    }
    const app = activation.app?.ref
    if (app) {
      for (const contract of selectionKeyContractsForAppFamily(app, file)) {
        if (!contract.keys.has(activation.key)) {
          ctx.error(
            navigationValidationMessages.unknownSelection(contract.app.name, activation.key.slice(1)),
            activation,
          )
        }
      }
    }
  },
  [AST.ReplaceStatement.$type]: (replace, ctx) => {
    if (!AST.findOwningView(replace)) {
      ctx.error(navigationValidationMessages.replaceContext, replace)
    }
    const actual = Type.ofExpression(replace.navigator)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(navigationValidationMessages.replaceNavigator(Type.displayName(actual)), replace.navigator)
    }
    void replace.app?.ref
  },
} satisfies NodeValidationChecks

function validateViewBinding(binding: AST.ViewBinding, ctx: ValidationContext): void {
  const view = binding.view.ref
  if (!view) {
    return
  }
  const resolved = ASTUtils.resolveArgumentBindings(view, binding)
  for (const diagnostic of resolved.diagnostics) {
    reportBindingDiagnostic(view, diagnostic, binding, ctx)
  }
}

type EffectiveNavigatorConfiguration = {
  declaration: AST.ConfigurableDeclaration
  keys: ReadonlySet<string>
}

type SelectionKeyContract = {
  app: AST.AppValueDeclaration
  keys: ReadonlySet<string>
}

function selectionKeyContractsForAppFamily(
  app: AST.AppValueDeclaration,
  file: AST.TaoFile,
): SelectionKeyContract[] {
  const root = ASTUtils.rootAppValue(app)
  if (!root) {
    return []
  }
  return AST.appValueDeclarationsInFile(file).filter(candidate => ASTUtils.rootAppValue(candidate) === root).flatMap(
    candidate => {
      const keys = selectionKeysForApp(candidate)
      return keys ? [{ app: candidate, keys }] : []
    },
  )
}

function selectionKeysForApp(app: AST.AppValueDeclaration): ReadonlySet<string> | undefined {
  const navigator = effectiveNavigatorProperty(app)
  if (!navigator) {
    return undefined
  }
  let configuration = configurationValueConfiguration(navigator.value)
  for (const patch of navigator.patches) {
    configuration = applyConfigurationPatch(configuration, patch)
  }
  if (!configuration) {
    return undefined
  }
  return AST.configurationKeyOf(configuration.declaration) ? configuration.keys : new Set()
}

type EffectiveAppProperty = {
  patches: AST.ConfigurationBlock[]
  value: AST.Expression | AST.ConfigurationValue
}

function effectiveNavigatorProperty(
  app: AST.AppValueDeclaration,
  seen: Set<AST.AppValueDeclaration> = new Set(),
): EffectiveAppProperty | undefined {
  if (seen.has(app)) {
    return undefined
  }
  seen.add(app)
  if (AST.isAppDeclaration(app) && app.block) {
    let result: EffectiveAppProperty | undefined
    for (const property of AST.blockStatements(app).filter(AST.isAppProperty)) {
      if (property.name !== 'Navigator') {
        continue
      }
      if (property.value) {
        result = { patches: [], value: property.value }
      } else if (property.patch && result) {
        result.patches.push(property.patch.block)
      }
    }
    return result
  }
  return app.value ? effectiveNavigatorFromAppExpression(app.value, seen) : undefined
}

function effectiveNavigatorFromAppExpression(
  expression: AST.Expression,
  seen: Set<AST.AppValueDeclaration>,
): EffectiveAppProperty | undefined {
  if (AST.isPrimitiveConfigurationConstructor(expression)) {
    return navigatorFromConfigurationBlock(expression.block)
  }
  if (AST.isConfigurationConstructor(expression)) {
    const declaration = expression.type.ref
    let result = declaration && AST.isConfigurableDeclaration(declaration)
      ? defaultNavigatorProperty(declaration)
      : undefined
    return navigatorFromConfigurationBlock(expression.block, result)
  }
  if (AST.isInferredConfigurationConstructor(expression)) {
    const owner = expression.$container
    const declaration = AST.isAliasDeclaration(owner) ? Type.visibleDeclaration(owner, owner.name) : undefined
    const result = declaration && AST.isConfigurableDeclaration(declaration)
      ? defaultNavigatorProperty(declaration)
      : undefined
    return navigatorFromConfigurationBlock(expression.block, result)
  }
  if (!AST.isRefinementExpression(expression) && !AST.isValueReference(expression)) {
    return undefined
  }
  const target = expression.target.ref
  let result = AST.isConcreteAppValueDeclaration(target)
    ? effectiveNavigatorProperty(target, seen)
    : target && AST.isConfigurableDeclaration(target) && AST.configurationPrimitiveOf(target) === 'app'
    ? defaultNavigatorProperty(target)
    : undefined
  return AST.isRefinementExpression(expression)
    ? navigatorFromConfigurationBlock(expression.patchBlock, result)
    : result
}

function defaultNavigatorProperty(
  declaration: AST.ConfigurableDeclaration,
): EffectiveAppProperty | undefined {
  const property = AST.configurationPropertiesOf(declaration).find(candidate => candidate.name === 'Navigator')
  return property?.value ? { patches: [], value: property.value } : undefined
}

function navigatorFromConfigurationBlock(
  block: AST.ConfigurationBlock | undefined,
  initial?: EffectiveAppProperty,
): EffectiveAppProperty | undefined {
  let result = initial
  for (const entry of block?.entries ?? []) {
    if (entry.name !== 'Navigator' || !entry.value) {
      continue
    }
    if (AST.isPropertyConfigurationPatch(entry.value)) {
      result?.patches.push(entry.value.block)
    } else {
      result = { patches: [], value: entry.value }
    }
  }
  return result
}

function configuredExpressionConfiguration(
  value: AST.Expression,
  seen: Set<AST.AliasDeclaration> = new Set(),
): EffectiveNavigatorConfiguration | undefined {
  if (AST.isConfigurationConstructor(value) && value.type.ref && AST.isConfigurableDeclaration(value.type.ref)) {
    return configuration(value.type.ref, value.block)
  }
  if (!AST.isRefinementExpression(value) && !AST.isValueReference(value)) {
    return undefined
  }
  const target = value.target.ref
  if (AST.isNavDeclaration(target)) {
    return target.value ? configuredExpressionConfiguration(target.value, seen) : undefined
  }
  if (!AST.isAliasDeclaration(target) || seen.has(target)) {
    return undefined
  }
  seen.add(target)
  const base = configuredExpressionConfiguration(target.value, seen)
  return AST.isRefinementExpression(value) ? applyConfigurationPatch(base, value.patchBlock) : base
}

function configurationValueConfiguration(
  value: AST.Expression | AST.ConfigurationValue,
): EffectiveNavigatorConfiguration | undefined {
  if (AST.isExpression(value)) {
    return configuredExpressionConfiguration(value)
  }
  if (!AST.isConfigurationReference(value)) {
    return undefined
  }
  const target = value.target.ref
  if (target && AST.isConfigurableDeclaration(target)) {
    return configuration(target)
  }
  return AST.isAliasDeclaration(target)
    ? configuredExpressionConfiguration(target.value)
    : AST.isNavDeclaration(target) && target.value
    ? configuredExpressionConfiguration(target.value)
    : undefined
}

function configuration(
  declaration: AST.ConfigurableDeclaration,
  block?: AST.ConfigurationBlock,
): EffectiveNavigatorConfiguration {
  return {
    declaration,
    keys: new Set(block?.entries.map(entry => entry.key).filter((key): key is string => key !== undefined)),
  }
}

function applyConfigurationPatch(
  base: EffectiveNavigatorConfiguration | undefined,
  patch?: AST.ConfigurationBlock,
): EffectiveNavigatorConfiguration | undefined {
  if (!base || !patch) {
    return base
  }
  return {
    declaration: base.declaration,
    keys: new Set([
      ...base.keys,
      ...patch.entries.map(entry => entry.key).filter((key): key is string => key !== undefined),
    ]),
  }
}

type ToastPresentation = AST.ToastPresentationOptions | undefined

function validateContextualPresentation(
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  const toast = presentation.mode?.kind === 'toast' ? presentation.mode.toast : undefined
  validatePresentationMode(presentation, toast, ctx)
  validatePresentationArguments(presentation, ctx)
  validatePresentationTarget(presentation, toast, ctx)
  validatePresentedViewTitle(presentation, ctx)
}

function validateStackInitialTitle(entry: AST.ConfigurationEntry, ctx: ValidationContext): void {
  if (!stackInitialHost(entry)) {
    return
  }
  const value = entry.value
  if (!value) {
    return
  }
  if (AST.isViewBinding(value)) {
    if (value.view.ref) {
      reportMissingHostTitle(value.view.ref, entry, ctx)
    }
    return
  }
  if (AST.isConfigurationReference(value)) {
    validateReferencedStackDestinationTitle(value.target.ref, entry, ctx)
    return
  }
  if (!AST.isExpression(value)) {
    return
  }
  const configuration = configuredExpressionConfiguration(value)
  if (
    configuration
    && AST.configurationPrimitiveOf(configuration.declaration) === 'nav'
    && !configurationExpressionFillsTitle(value, new Set())
  ) {
    ctx.error(navigationValidationMessages.missingNavHostTitle(configuration.declaration.name), entry)
  }
}

/**
 * validateFrameSlot enforces the frame's slot vocabulary.
 *
 * A type declares at most one `@key` contract, so the five slot names cannot be five declared
 * members. The stdlib FrameNav declaration is recognized by name and path — the same recognition
 * `isStackNavDeclaration` does — and the names it accepts are checked here instead.
 */
function validateFrameSlot(entry: AST.ConfigurationEntry, ctx: ValidationContext): void {
  const key = entry.key
  if (!key || !isFrameNavDeclaration(keyedConfigurationHost(entry))) {
    return
  }
  if (!frameNavSlotKeys.some(slot => slot === key)) {
    ctx.error(navigationValidationMessages.unknownFrameSlot(key), entry)
    return
  }
  if (key !== '@center') {
    return
  }
  for (const property of entry.block?.entries ?? []) {
    if (property.name === 'Size') {
      ctx.error(navigationValidationMessages.frameCenterSize, property)
    }
  }
}

/** keyedConfigurationHost resolves the configurable declaration one keyed item is configuring. */
function keyedConfigurationHost(entry: AST.ConfigurationEntry): AST.ConfigurableDeclaration | undefined {
  const block = entry.$container
  const constructor = AST.isConfigurationBlock(block) ? block.$container : undefined
  const declaration = AST.isConfigurationConstructor(constructor)
    ? constructor.type.ref
    : AST.isRefinementExpression(constructor)
    ? configuredExpressionConfiguration(constructor)?.declaration
    : AST.isInferredConfigurationConstructor(constructor)
    ? inferredConfigurationHost(constructor)
    : undefined
  return AST.isTypeDeclaration(declaration) && AST.isConfigurableDeclaration(declaration) ? declaration : undefined
}

function inferredConfigurationHost(
  constructor: AST.InferredConfigurationConstructor,
): AST.ConfigurableDeclaration | undefined {
  const owner = constructor.$container
  const declaration = AST.isAliasDeclaration(owner) ? Type.visibleDeclaration(owner, owner.name) : undefined
  return declaration && AST.isConfigurableDeclaration(declaration) ? declaration : undefined
}

/** isFrameNavDeclaration follows transparent aliases and nominal ancestry to the stdlib family. */
function isFrameNavDeclaration(
  declaration: AST.ConfigurableDeclaration | undefined,
  seen: Set<AST.TypeDeclaration> = new Set(),
): boolean {
  if (!declaration || seen.has(declaration)) {
    return false
  }
  seen.add(declaration)
  if (AST.configurationPrimitiveOf(declaration) !== 'nav') {
    return false
  }
  const path = AST.getDocument(declaration).uri.path
  if (
    declaration.name === 'FrameNav'
    && (path.endsWith('/@tao/nav/native/Navigation.tao')
      || path.endsWith('/@tao/nav/basic/Navigation.tao'))
  ) {
    return true
  }
  const aliasTarget = declaration.aliasTarget?.member.ref
  if (AST.isTypeDeclaration(aliasTarget) && isFrameNavDeclaration(aliasTarget, seen)) {
    return true
  }
  const type = declaration.type
  const base = type && AST.isDerivedTypeExpression(type) ? type.base : type
  if (!base || !AST.isNamedTypeReference(base) || base.members.length > 0) {
    return false
  }
  const parent = Type.visibleDeclaration(declaration, base.root)
  return parent && AST.isConfigurableDeclaration(parent) ? isFrameNavDeclaration(parent, seen) : false
}

function stackInitialHost(entry: AST.ConfigurationEntry): AST.ConfigurableDeclaration | undefined {
  if (entry.name !== 'Initial' || !entry.value) {
    return undefined
  }
  const block = entry.$container
  const constructor = AST.isConfigurationBlock(block) ? block.$container : undefined
  const declaration = AST.isConfigurationConstructor(constructor)
    ? constructor.type.ref
    : AST.isRefinementExpression(constructor)
    ? configuredExpressionConfiguration(constructor)?.declaration
    : undefined
  return AST.isTypeDeclaration(declaration) && isStackNavDeclaration(declaration) ? declaration : undefined
}

function validateReferencedStackDestinationTitle(
  destination: AST.NamedDeclaration | undefined,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const view = referencedViewDeclaration(destination)
  if (view) {
    reportMissingHostTitle(view, node, ctx)
    return
  }
  if (
    (AST.isNavDeclaration(destination) || AST.isAliasDeclaration(destination))
    && Type.isAssignable(Type.ofValueDeclaration(destination), { kind: 'primitive', primitive: 'nav' })
    && !configuredValueFillsTitle(destination)
  ) {
    ctx.error(navigationValidationMessages.missingNavHostTitle(destination.name), node)
  }
}

function configuredValueFillsTitle(
  declaration: AST.NavDeclaration | AST.AliasDeclaration,
  seen: Set<AST.ValueDeclaration> = new Set(),
): boolean {
  if (seen.has(declaration)) {
    return false
  }
  seen.add(declaration)
  return configurationExpressionFillsTitle(declaration.value, seen)
}

function configurationExpressionFillsTitle(
  expression: AST.Expression | undefined,
  seen: Set<AST.ValueDeclaration>,
): boolean {
  if (!expression) {
    return false
  }
  if (AST.isConfigurationConstructor(expression)) {
    return configurationBlockFillsTitle(expression.block)
      || configurationTypeHasMeaningfulTitle(expression.type.ref)
  }
  if (AST.isRefinementExpression(expression)) {
    if (configurationBlockFillsTitle(expression.patchBlock)) {
      return true
    }
  }
  if (!AST.isRefinementExpression(expression) && !AST.isValueReference(expression)) {
    return false
  }
  const target = expression.target.ref
  return (AST.isNavDeclaration(target) || AST.isAliasDeclaration(target))
    ? configuredValueFillsTitle(target, seen)
    : false
}

function configurationBlockFillsTitle(block: AST.ConfigurationBlock | undefined): boolean {
  return block?.entries.some(entry => entry.name === 'Title' && entry.value !== undefined) ?? false
}

function configurationTypeHasMeaningfulTitle(declaration: AST.ConstructorDeclaration | undefined): boolean {
  if (!AST.isTypeDeclaration(declaration) || !AST.isConfigurableDeclaration(declaration)) {
    return false
  }
  const value = AST.configurationPropertiesOf(declaration).find(property => property.name === 'Title')?.value
  return value !== undefined
    && !(AST.isStringLiteral(value) && value.value === '')
    && !AST.isNoneLiteral(value)
}

function validatePresentedViewTitle(
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  if (presentation.mode) {
    return
  }
  const view = presentation.view.ref
  if (!view) {
    return
  }
  if (presentation.target?.value) {
    const configuration = configuredExpressionConfiguration(presentation.target.value)
    if (configuration && isStackNavDeclaration(configuration.declaration)) {
      reportMissingHostTitle(view, presentation, ctx)
    }
    return
  }
  const auxiliary = presentation.target ? auxiliaryNavigatorForTarget(presentation.target) : undefined
  if (auxiliary) {
    const configuration = configuredExpressionConfiguration(auxiliary.value)
    if (configuration && isStackNavDeclaration(configuration.declaration)) {
      reportMissingHostTitle(view, presentation, ctx)
    }
    return
  }
  if (!presentation.target) {
    const owner = AST.findOwningView(presentation)
    const reachability = stackReachability(ctx.workspaceFiles)
    if (
      owner
      && reachability.pushContexts.has(canonicalView(owner))
      && reachability.destinations.has(canonicalView(view))
    ) {
      reportMissingHostTitle(view, presentation, ctx)
    }
  }
}

type StackReachability = {
  destinations: Set<AST.ViewDeclaration>
  pushContexts: Set<AST.ViewDeclaration>
}

function stackReachability(files: readonly AST.TaoFile[]): StackReachability {
  const nodes = files.flatMap(file => AST.streamAllContents(file))
  const destinations = new Set<AST.ViewDeclaration>()
  const pushContexts = new Set<AST.ViewDeclaration>()
  for (const node of nodes) {
    if (AST.isConfigurationEntry(node)) {
      const destination = stackInitialDestination(node)
      if (destination) {
        destinations.add(destination)
        pushContexts.add(destination)
      }
      continue
    }
    if (AST.isContextualPresentStatement(node) && node.target && node.view.ref) {
      const targetValue = node.target.value ?? auxiliaryNavigatorForTarget(node.target)?.value
      const configuration = targetValue ? configuredExpressionConfiguration(targetValue) : undefined
      if (configuration && isStackNavDeclaration(configuration.declaration)) {
        const destination = canonicalView(node.view.ref)
        pushContexts.add(destination)
        if (!node.mode) {
          destinations.add(destination)
        }
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (AST.isRender(node)) {
        const owner = AST.findOwningView(node)
        const rendered = node.view?.ref
        if (owner && rendered && pushContexts.has(canonicalView(owner))) {
          const destination = canonicalView(rendered)
          if (!pushContexts.has(destination)) {
            pushContexts.add(destination)
            changed = true
          }
        }
        continue
      }
      if (!AST.isContextualPresentStatement(node) || node.target || !node.view.ref) {
        continue
      }
      const owner = AST.findOwningView(node)
      const destination = canonicalView(node.view.ref)
      if (!owner || !pushContexts.has(canonicalView(owner))) {
        continue
      }
      if (!pushContexts.has(destination)) {
        pushContexts.add(destination)
        changed = true
      }
      if (!node.mode && !destinations.has(destination)) {
        destinations.add(destination)
        changed = true
      }
    }
  }
  return { destinations, pushContexts }
}

function stackInitialDestination(entry: AST.ConfigurationEntry): AST.ViewDeclaration | undefined {
  if (entry.name !== 'Initial' || !entry.value) {
    return undefined
  }
  if (!stackInitialHost(entry)) {
    return undefined
  }
  if (AST.isViewBinding(entry.value)) {
    return entry.value.view.ref ? canonicalView(entry.value.view.ref) : undefined
  }
  return AST.isConfigurationReference(entry.value)
    ? referencedViewDeclaration(entry.value.target.ref)
    : undefined
}

function referencedViewDeclaration(
  declaration: AST.NamedDeclaration | undefined,
  seen: Set<AST.AliasDeclaration> = new Set(),
): AST.ViewDeclaration | undefined {
  if (AST.isViewDeclaration(declaration)) {
    return canonicalView(declaration)
  }
  if (!AST.isAliasDeclaration(declaration) || seen.has(declaration)) {
    return undefined
  }
  seen.add(declaration)
  return AST.isValueReference(declaration.value)
    ? referencedViewDeclaration(declaration.value.target.ref, seen)
    : undefined
}

function canonicalView(view: AST.ViewDeclaration): AST.ViewDeclaration {
  const target = AST.viewAliasTarget(view)
  return AST.isViewDeclaration(target) ? target : view
}

function reportMissingHostTitle(
  view: AST.ViewDeclaration,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const declaration = canonicalView(view)
  // A plain view is legal here and shows Back-only header chrome: a scene is the way to ADD chrome,
  // not a requirement for presentation. Only a scene, which can fill Title, is held to filling it —
  // and not one that has suppressed its header, where a title would be chrome nothing reads.
  if (!declaration.scene || sceneSuppressesHeader(declaration)) {
    return
  }
  if (!AST.declarationSlotFillNamed(declaration, 'Title')) {
    ctx.error(navigationValidationMessages.missingHostTitle(view.name), node)
  }
}

/** isStackNavDeclaration follows transparent aliases and nominal ancestry to the stdlib family. */
function isStackNavDeclaration(
  declaration: AST.ConfigurableDeclaration,
  seen: Set<AST.TypeDeclaration> = new Set(),
): boolean {
  if (seen.has(declaration)) {
    return false
  }
  seen.add(declaration)
  if (AST.configurationPrimitiveOf(declaration) !== 'nav') {
    return false
  }
  const path = AST.getDocument(declaration).uri.path
  if (
    declaration.name === 'StackNav'
    && (path.endsWith('/@tao/nav/native/Navigation.tao')
      || path.endsWith('/@tao/nav/basic/Navigation.tao'))
  ) {
    return true
  }
  const aliasTarget = declaration.aliasTarget?.member.ref
  if (AST.isTypeDeclaration(aliasTarget) && isStackNavDeclaration(aliasTarget, seen)) {
    return true
  }
  const type = declaration.type
  const base = type && AST.isDerivedTypeExpression(type) ? type.base : type
  if (!base || !AST.isNamedTypeReference(base) || base.members.length > 0) {
    return false
  }
  const parent = Type.visibleDeclaration(declaration, base.root)
  return parent ? isStackNavDeclaration(parent, seen) : false
}

function validatePresentationMode(
  presentation: AST.ContextualPresentStatement,
  toast: ToastPresentation,
  ctx: ValidationContext,
): void {
  const owningView = AST.findOwningView(presentation)
  if (!owningView) {
    ctx.error(
      toast ? navigationValidationMessages.toastContext : navigationValidationMessages.presentationContext,
      presentation,
    )
  }
  if (toast && presentation.target) {
    ctx.error(navigationValidationMessages.toastTarget, presentation.target)
  }
  if (toast) {
    const keyType = Type.ofExpression(toast.key)
    if (keyType.kind !== 'unresolved' && !Type.isAssignable(keyType, { kind: 'primitive', primitive: 'text' })) {
      ctx.error(navigationValidationMessages.toastKeyType(Type.displayName(keyType)), toast.key)
    }
    const durationType = Type.ofExpression(toast.duration)
    if (
      durationType.kind !== 'unresolved'
      && !Type.isAssignable(durationType, { kind: 'primitive', primitive: 'duration' })
    ) {
      ctx.error(navigationValidationMessages.toastDurationType(Type.displayName(durationType)), toast.duration)
    }
    if (negativeNumberLiteral(toast.duration)) {
      ctx.error(navigationValidationMessages.toastDurationNegative, toast.duration)
    }
  }
}

function validatePresentationArguments(
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  const view = presentation.view.ref
  if (view) {
    const resolved = ASTUtils.resolveArgumentBindings(view, presentation)
    for (const diagnostic of resolved.diagnostics) {
      reportBindingDiagnostic(view, diagnostic, presentation, ctx)
    }
    if (presentation.mode?.kind !== 'toast') {
      for (const { argument, parameter } of resolved.pairs) {
        const parameterType = Type.ofParameter(parameter)
        if (parameterType.kind === 'primitive' && parameterType.primitive === 'action') {
          ctx.error(
            navigationValidationMessages.nonRestorableArgument(view.name, Type.parameterName(parameter)),
            argument,
          )
        }
      }
    }
  }
}

function validatePresentationTarget(
  presentation: AST.ContextualPresentStatement,
  toast: ToastPresentation,
  ctx: ValidationContext,
): void {
  const target = presentation.target
  if (!target || toast) {
    return
  }
  if (target.value) {
    const actual = Type.ofExpression(target.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(navigationValidationMessages.presentationTarget(Type.displayName(actual)), target)
    }
    return
  }
  const app = target.app?.ref
  if (!app || !target.key) {
    return
  }
  const targetKey = target.key.slice(1)
  const auxiliary = auxiliaryNavigatorForTarget(target)
  if (!auxiliary) {
    ctx.error(navigationValidationMessages.unknownAuxiliary(app.name, targetKey), target)
  }
}

function auxiliaryNavigatorForTarget(target: AST.NavigationTarget): AST.AppAuxiliaryNavigator | undefined {
  const app = target.app?.ref
  const rootApp = app ? ASTUtils.rootAppValue(app) : undefined
  return rootApp && AST.isAppDeclaration(rootApp) && target.key
    ? AST.blockStatements(rootApp).find(
      (statement): statement is AST.AppAuxiliaryNavigator =>
        AST.isAppAuxiliaryNavigator(statement) && statement.name === target.key,
    )
    : undefined
}

function negativeNumberLiteral(expression: AST.Expression): boolean {
  if (!AST.isUnaryExpression(expression) || expression.operator !== '-') {
    return false
  }
  const operand = AST.isPostfixMemberAccess(expression.operand) ? expression.operand.receiver : expression.operand
  return AST.isNumberLiteral(operand)
}

function reportBindingDiagnostic(
  view: AST.ViewDeclaration,
  diagnostic: ASTUtils.ArgumentBindingDiagnostic,
  presentation: AST.ContextualPresentStatement | AST.ViewBinding,
  ctx: ValidationContext,
): void {
  Switch.kind(diagnostic, {
    'missing-argument': diagnostic => {
      ctx.error(
        navigationValidationMessages.missingArgument(view.name, Type.parameterName(diagnostic.parameter)),
        presentation,
      )
    },
    'unmatched-argument': diagnostic => {
      ctx.error(navigationValidationMessages.unmatchedArgument(view.name), diagnostic.argument)
    },
    'ambiguous-argument': diagnostic => {
      ctx.error(navigationValidationMessages.ambiguousArgument(view.name, diagnostic.parameters), diagnostic.argument)
    },
    'ambiguous-parameter': diagnostic => {
      ctx.error(
        navigationValidationMessages.ambiguousParameter(view.name, Type.parameterName(diagnostic.parameter)),
        presentation,
      )
    },
    'duplicate-argument-type': diagnostic => {
      ctx.error(navigationValidationMessages.duplicateArgumentType(view.name), diagnostic.argument)
    },
    'duplicate-parameter-type': diagnostic => {
      ctx.error(
        navigationValidationMessages.duplicateParameterType(view.name, Type.parameterName(diagnostic.parameter)),
        presentation,
      )
    },
    'unknown-named-argument': diagnostic => {
      ctx.error(navigationValidationMessages.unknownNamedArgument(view.name, diagnostic.name), diagnostic.argument)
    },
    'duplicate-named-argument': diagnostic => {
      ctx.error(
        navigationValidationMessages.duplicateNamedArgument(view.name, Type.parameterName(diagnostic.parameter)),
        diagnostic.argument,
      )
    },
    'named-argument-type': diagnostic => {
      ctx.error(
        navigationValidationMessages.namedArgumentType(
          view.name,
          Type.parameterName(diagnostic.parameter),
          Type.displayName(Type.ofParameter(diagnostic.parameter)),
          Type.displayName(Type.ofArgument(diagnostic.argument)),
        ),
        diagnostic.argument,
      )
    },
  })
}
