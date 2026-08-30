import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { configuredValueValidationMessages } from './configured-values-validator'

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
} as const

/** navigationValidationChecks validates configured navigation and presentation calls. */
export const navigationValidationChecks = {
  [AST.ContextualPresentStatement.$type]: validateContextualPresentation,
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
  const rootApp = ASTUtils.rootAppValue(app)
  const auxiliary = rootApp
    && AST.isAppDeclaration(rootApp)
    && AST.blockStatements(rootApp).find(statement =>
      AST.isAppAuxiliaryNavigator(statement) && statement.name.slice(1) === targetKey
    )
  if (!auxiliary) {
    ctx.error(navigationValidationMessages.unknownAuxiliary(app.name, targetKey), target)
  }
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
  presentation: AST.ContextualPresentStatement,
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
