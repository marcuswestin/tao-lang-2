import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from '../validation'

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
  presentationContext: 'Contextual presentation is allowed only inside a ui declaration.',
  toastContext: 'Toast presentation is allowed only inside a rendered declaration.',
  toastTarget: 'Toast presentation is app-level and does not accept `in`.',
  toastKeyType: (actual: string) => `Toast Key expects text, got ${actual}.`,
  toastDurationType: (actual: string) => `Toast Duration expects number, got ${actual}.`,
  toastDurationNegative: 'Toast Duration cannot be negative.',
  activationContext: 'Selection activation is allowed only inside a ui declaration.',
  strictTargetDeclaration: (name: string) =>
    `Strict app target '${name}' must name an app declaration, not an app variant.`,
  unknownSelection: (app: string, key: string) => `App ${app} navigator has no selection item named '@${key}'.`,
  patchTarget: (name: string) =>
    `\`with\` can patch only an app, nav, or datasource value; ${name} is not configurable.`,
  presentationTarget: (actual: string) => `Presentation target expects nav, got ${actual}.`,
  dismissContext: '`dismiss` is allowed only inside a ui declaration.',
  replaceContext: '`replace` is allowed only inside a visual declaration.',
  replaceNavigator: (actual: string) => `Replacement expects nav, got ${actual}.`,
  unknownAuxiliary: (app: string, key: string) => `App ${app} has no auxiliary navigator named '@${key}'.`,
  unknownConfiguration: (type: string, name: string) => `${type} has no configuration slot named '${name}'.`,
  duplicateConfiguration: (type: string, name: string) => `${type} configures '${name}' more than once.`,
  missingConfiguration: (type: string, name: string) => `${type} requires configuration '${name}'.`,
  configurationType: (name: string, expected: string, actual: string) => `${name} expects ${expected}, got ${actual}.`,
  configurationKeyType: (name: string) => `${name} expects an @key.`,
  keyedConfiguration: (type: string) => `${type} does not accept keyed configuration entries.`,
  duplicateConfigurationKey: (type: string, key: string) => `${type} configures key '${key}' more than once.`,
  missingKeyedItem: (type: string) => `${type} requires at least one keyed item.`,
  unknownConfigurationKey: (type: string, name: string, key: string) =>
    `${type} ${name} references unknown item '${key}'.`,
  keyedItemConfiguration: (type: string, key: string, name: string) =>
    `${type} item '${key}' has no configuration slot named '${name}'.`,
  keyedItemMissing: (type: string, key: string, name: string) => `${type} item '${key}' requires '${name}'.`,
  constructorBlock: (name: string) => `${name} configuration requires a block.`,
} as const

/** validateNavigation validates configured navigation and presentation calls. */
export function validateNavigation(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const presentation of AST.streamAllContents(file).filter(AST.isContextualPresentStatement)) {
    validateContextualPresentation(presentation, ctx)
  }
  for (const dismiss of AST.streamAllContents(file).filter(AST.isDismissStatement)) {
    if (!AST.findOwningView(dismiss)) {
      ctx.error(navigationValidationMessages.dismissContext, dismiss)
    }
  }
  for (const activation of AST.streamAllContents(file).filter(AST.isSelectionActivateStatement)) {
    if (!AST.isUiDeclaration(AST.findOwningView(activation))) {
      ctx.error(navigationValidationMessages.activationContext, activation)
    }
    const app = activation.app.ref
    if (app && AST.isAppVariantDeclaration(app)) {
      ctx.error(navigationValidationMessages.strictTargetDeclaration(app.name), activation)
    } else if (app) {
      for (const contract of selectionKeyContractsForAppFamily(app, file)) {
        if (!contract.keys.has(activation.key)) {
          ctx.error(
            navigationValidationMessages.unknownSelection(contract.app.name, activation.key.slice(1)),
            activation,
          )
        }
      }
    }
  }
  for (const replace of AST.streamAllContents(file).filter(AST.isReplaceStatement)) {
    if (!AST.findOwningView(replace)) {
      ctx.error(navigationValidationMessages.replaceContext, replace)
    }
    const actual = Type.ofExpression(replace.navigator)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
      ctx.error(navigationValidationMessages.replaceNavigator(Type.displayName(actual)), replace.navigator)
    }
    const app = replace.app.ref
    if (app && AST.isAppVariantDeclaration(app)) {
      ctx.error(navigationValidationMessages.strictTargetDeclaration(app.name), replace)
    }
  }
  for (const configured of AST.streamAllContents(file).filter(AST.isConfiguredValue)) {
    validateConfiguredValue(configured, ctx)
  }
  for (const patch of AST.streamAllContents(file).filter(AST.isPatchedValueReference)) {
    const base = patch.target.ref
    if (AST.isAppVariantDeclaration(patch.$container)) {
      continue
    }
    if (!AST.isAliasDeclaration(base)) {
      if (base) {
        ctx.error(navigationValidationMessages.patchTarget(patch.target.$refText), patch)
      }
      continue
    }
    const declaration = configuredDeclaration(base.value)
    if (!declaration) {
      ctx.error(navigationValidationMessages.patchTarget(base.name), patch)
      continue
    }
    validateConfigurationBlock(patch.patchBlock, declaration, false, ctx)
  }
  for (const variant of file.statements.filter(AST.isAppVariantDeclaration)) {
    const root = AST.appDeclarationOf(variant)
    if (!root) {
      continue
    }
    for (const entry of variant.value.patchBlock.entries) {
      if (!entry.name || !AST.isPropertyConfigurationPatch(entry.value)) {
        continue
      }
      const declaration = appPropertyConfiguredType(root, entry.name)
      if (declaration) {
        validateConfigurationBlock(entry.value.block, declaration, false, ctx)
      }
    }
  }
}

function appPropertyConfiguredType(
  app: AST.AppDeclaration,
  property: string,
): AST.ConfigurableDeclaration | undefined {
  const statement = AST.blockStatements(app).find(candidate =>
    (property === 'Navigator' && AST.isAppNavigator(candidate))
    || (property === 'Datasource' && AST.isAppDatasource(candidate))
  )
  if (!statement || (!AST.isAppNavigator(statement) && !AST.isAppDatasource(statement))) {
    return undefined
  }
  const target = statement.value.target.ref
  if (AST.isConfigurableDeclaration(target) || AST.isTypeDeclaration(target)) {
    return AST.isConfigurableDeclaration(target) ? target : undefined
  }
  return AST.isAliasDeclaration(target) ? configuredDeclaration(target.value) : undefined
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
  const root = AST.appDeclarationOf(app)
  if (!root) {
    return []
  }
  const variants = file.statements
    .filter(AST.isAppVariantDeclaration)
    .filter(variant => AST.appDeclarationOf(variant) === root)
  return [root, ...variants].flatMap(candidate => {
    const keys = selectionKeysForApp(candidate)
    return keys ? [{ app: candidate, keys }] : []
  })
}

function selectionKeysForApp(app: AST.AppValueDeclaration): ReadonlySet<string> | undefined {
  const root = AST.appDeclarationOf(app)
  if (!root) {
    return undefined
  }
  const navigator = AST.blockStatements(root).find(AST.isAppNavigator)
  if (!navigator) {
    return undefined
  }
  let configuration = configuredAppPropertyConfiguration(navigator.value)
  for (const variant of appVariantChain(app)) {
    const patch = variant.value.patchBlock.entries.find(entry => entry.name === 'Navigator')?.value
    if (AST.isPropertyConfigurationPatch(patch)) {
      configuration = applyConfigurationPatch(configuration, patch.block)
    } else if (patch) {
      configuration = configurationValueConfiguration(patch)
    }
  }
  if (!configuration) {
    return undefined
  }
  return AST.configurationKeyOf(configuration.declaration) ? configuration.keys : new Set()
}

function appVariantChain(
  app: AST.AppValueDeclaration,
  seen: Set<AST.AliasDeclaration> = new Set(),
): AST.AppVariantDeclaration[] {
  if (!AST.isAppVariantDeclaration(app) || seen.has(app)) {
    return []
  }
  seen.add(app)
  const base = app.value.target.ref
  if (!AST.isAppValueDeclaration(base)) {
    return []
  }
  return [...appVariantChain(base, seen), app]
}

function configuredAppPropertyConfiguration(
  value: AST.ConfiguredAppPropertyValue,
): EffectiveNavigatorConfiguration | undefined {
  const target = value.target.ref
  if (AST.isConfigurableDeclaration(target)) {
    return configuration(target, value.block)
  }
  if (!AST.isAliasDeclaration(target)) {
    return undefined
  }
  return applyConfigurationPatch(configuredExpressionConfiguration(target.value), value.block)
}

function configuredExpressionConfiguration(
  value: AST.Expression,
  seen: Set<AST.AliasDeclaration> = new Set(),
): EffectiveNavigatorConfiguration | undefined {
  if (AST.isConfigurationConstructor(value) && AST.isConfigurableDeclaration(value.type.ref)) {
    return configuration(value.type.ref, value.block)
  }
  if (!AST.isValueReference(value)) {
    return undefined
  }
  const target = value.target.ref
  if (!AST.isAliasDeclaration(target) || seen.has(target)) {
    return undefined
  }
  seen.add(target)
  const base = configuredExpressionConfiguration(target.value, seen)
  return AST.isPatchedValueReference(value) ? applyConfigurationPatch(base, value.patchBlock) : base
}

function configurationValueConfiguration(
  value: AST.ConfigurationValue,
): EffectiveNavigatorConfiguration | undefined {
  if (AST.isConfigurationConstructor(value) && AST.isConfigurableDeclaration(value.type.ref)) {
    return configuration(value.type.ref, value.block)
  }
  if (!AST.isConfigurationReference(value)) {
    return undefined
  }
  const target = value.target.ref
  if (AST.isConfigurableDeclaration(target)) {
    return configuration(target)
  }
  return AST.isAliasDeclaration(target) ? configuredExpressionConfiguration(target.value) : undefined
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

function validateContextualPresentation(
  presentation: AST.ContextualPresentStatement,
  ctx: ValidationContext,
): void {
  const toast = presentation.mode?.kind === 'toast' ? presentation.mode.toast : undefined
  const owningView = AST.findOwningView(presentation)
  if (toast ? !owningView : !AST.isUiDeclaration(owningView)) {
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
      && !Type.isAssignable(durationType, { kind: 'primitive', primitive: 'number' })
    ) {
      ctx.error(navigationValidationMessages.toastDurationType(Type.displayName(durationType)), toast.duration)
    }
    if (negativeNumberLiteral(toast.duration)) {
      ctx.error(navigationValidationMessages.toastDurationNegative, toast.duration)
    }
  }
  const ui = presentation.ui.ref
  if (ui) {
    const resolved = ASTUtils.resolveArgumentBindings(ui, presentation)
    for (const diagnostic of resolved.diagnostics) {
      reportBindingDiagnostic(ui, diagnostic, presentation, ctx)
    }
  }
  if (presentation.target && !toast) {
    const targetApp = presentation.target.app?.ref
    if (presentation.target.value) {
      const actual = Type.ofExpression(presentation.target.value)
      if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, { kind: 'primitive', primitive: 'nav' })) {
        ctx.error(navigationValidationMessages.presentationTarget(Type.displayName(actual)), presentation.target)
      }
    } else if (targetApp && AST.isAppVariantDeclaration(targetApp)) {
      ctx.error(
        navigationValidationMessages.strictTargetDeclaration(targetApp.name),
        presentation.target,
      )
    } else if (presentation.target.app?.ref && presentation.target.key) {
      const app = presentation.target.app.ref
      const targetKey = presentation.target.key.slice(1)
      const rootApp = AST.appDeclarationOf(app)
      const auxiliary = rootApp
        && AST.blockStatements(rootApp).find(statement =>
          AST.isAppAuxiliaryNavigator(statement) && statement.name.slice(1) === targetKey
        )
      if (!auxiliary) {
        ctx.error(navigationValidationMessages.unknownAuxiliary(app.name, targetKey), presentation.target)
      }
    }
  }
}

function negativeNumberLiteral(expression: AST.Expression): boolean {
  return AST.isUnaryExpression(expression)
    && expression.operator === '-'
    && AST.isNumberLiteral(expression.operand)
}

function validateConfiguredValue(value: AST.ConfiguredValue, ctx: ValidationContext): void {
  const declaration = value.type.ref
  if (!AST.isConfigurableDeclaration(declaration)) {
    return
  }
  if (!value.block) {
    ctx.error(navigationValidationMessages.constructorBlock(declaration.name), value)
    return
  }
  validateConfigurationBlock(value.block, declaration, true, ctx)
}

function configuredDeclaration(
  value: AST.Expression,
  seen: Set<AST.AliasDeclaration> = new Set(),
): AST.ConfigurableDeclaration | undefined {
  if (AST.isConfigurationConstructor(value)) {
    return AST.isConfigurableDeclaration(value.type.ref) ? value.type.ref : undefined
  }
  if (AST.isValueReference(value)) {
    const base = value.target.ref
    if (!AST.isAliasDeclaration(base) || seen.has(base)) {
      return undefined
    }
    seen.add(base)
    return configuredDeclaration(base.value, seen)
  }
  return undefined
}

function validateConfigurationBlock(
  block: AST.ConfigurationBlock,
  declaration: AST.ConfigurableDeclaration,
  requireConstructorProperties: boolean,
  ctx: ValidationContext,
): void {
  const typeName = declaration.name
  const properties = AST.configurationPropertiesOf(declaration)
  const propertiesByName = new Map(properties.map(property => [property.name, property]))
  const keyedContract = AST.configurationKeyOf(declaration)
  const entries = new Map<string, AST.ConfigurationEntry>()
  const keyedEntries = new Map<string, AST.ConfigurationEntry>()
  for (const entry of block.entries) {
    if (entry.key) {
      if (!keyedContract) {
        ctx.error(navigationValidationMessages.keyedConfiguration(typeName), entry)
        continue
      }
      if (keyedEntries.has(entry.key)) {
        ctx.error(navigationValidationMessages.duplicateConfigurationKey(typeName, entry.key), entry)
      }
      keyedEntries.set(entry.key, entry)
      validateKeyedConfigurationItem(entry, declaration.name, keyedContract, ctx)
      continue
    }
    if (!entry.name || !entry.value) {
      continue
    }
    const property = propertiesByName.get(entry.name)
    if (!property) {
      ctx.error(navigationValidationMessages.unknownConfiguration(typeName, entry.name), entry)
      continue
    }
    if (entries.has(entry.name)) {
      ctx.error(navigationValidationMessages.duplicateConfiguration(typeName, entry.name), entry)
    }
    entries.set(entry.name, entry)
    validateConfiguredProperty(entry.value, property, entry, ctx)
  }
  for (const required of requireConstructorProperties ? properties : []) {
    if (!entries.has(required.name)) {
      ctx.error(navigationValidationMessages.missingConfiguration(typeName, required.name), block)
    }
  }
  if (keyedContract) {
    if (requireConstructorProperties && keyedEntries.size === 0) {
      ctx.error(navigationValidationMessages.missingKeyedItem(typeName), block)
    }
    for (const property of properties.filter(AST.configurationPropertyIsKey)) {
      const configuredValues = block.entries
        .filter(entry => entry.name === property.name)
        .map(entry => entry.value)
        .filter(AST.isConfigurationKeyValue)
      for (const configured of configuredValues) {
        if (!keyedEntries.has(configured.key)) {
          ctx.error(
            navigationValidationMessages.unknownConfigurationKey(typeName, property.name, configured.key),
            configured,
          )
        }
      }
    }
  }
}

function validateKeyedConfigurationItem(
  entry: AST.ConfigurationEntry,
  typeName: string,
  declaration: AST.ConfigurationKeyDeclaration,
  ctx: ValidationContext,
): void {
  const key = entry.key ?? ''
  const expectedByName = new Map(declaration.block.properties.map(property => [property.name, property]))
  const properties = new Map<string, AST.ConfigurationEntry>()
  for (const property of entry.block?.entries ?? []) {
    if (!property.name || !property.value) {
      ctx.error(navigationValidationMessages.keyedItemConfiguration(typeName, key, property.key ?? ''), property)
      continue
    }
    const expected = expectedByName.get(property.name)
    if (!expected) {
      ctx.error(navigationValidationMessages.keyedItemConfiguration(typeName, key, property.name), property)
      continue
    }
    if (properties.has(property.name)) {
      ctx.error(
        navigationValidationMessages.duplicateConfiguration(`${typeName} item ${key}`, property.name),
        property,
      )
    }
    properties.set(property.name, property)
    validateConfiguredProperty(property.value, expected, property, ctx)
  }
  for (const required of declaration.block.properties) {
    if (!properties.has(required.name)) {
      ctx.error(navigationValidationMessages.keyedItemMissing(typeName, key, required.name), entry)
    }
  }
}

function validateConfiguredProperty(
  value: AST.ConfigurationValue,
  property: AST.ConfigurationPropertyDeclaration,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  if (AST.configurationPropertyIsKey(property)) {
    if (!AST.isConfigurationKeyValue(value)) {
      ctx.error(navigationValidationMessages.configurationKeyType(property.name), node)
    }
    return
  }
  const actual = configurationValueType(value)
  const expected = Type.ofConfigurationProperty(property)
  if (actual.kind !== 'unresolved' && expected.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      navigationValidationMessages.configurationType(
        property.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
      node,
    )
  }
}

function configurationValueType(value: AST.ConfigurationValue): ASTUtils.TaoType {
  if (AST.isConfigurationReference(value)) {
    const target = value.target.ref
    if (AST.isTypeDeclaration(target)) {
      return Type.ofDefinition(target)
    }
    if (AST.isAliasDeclaration(target) || AST.isUiDeclaration(target)) {
      return Type.ofValueDeclaration(target)
    }
    return { kind: 'unresolved' }
  }
  if (AST.isConfigurationKeyValue(value) || AST.isPropertyConfigurationPatch(value)) {
    return { kind: 'unresolved' }
  }
  return Type.ofExpression(value)
}

function reportBindingDiagnostic(
  view: AST.VisualDeclaration,
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
