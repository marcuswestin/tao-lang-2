import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { referencedConfigurationType } from './configuration-type'
import { validateConfiguredItemPatch } from './configured-item-validator'

export const configuredValueValidationMessages = {
  patchTarget: (name: string) =>
    `\`with\` can patch only an app, nav, or datasource value; ${name} is not configurable.`,
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

export const configuredValueValidationChecks = {
  [AST.ConfiguredValue.$type]: validateConfiguredValue,
  [AST.ConfiguredAppPropertyValue.$type]: validateAppPropertyValue,
  [AST.InferredAppPropertyValue.$type]: validateAppPropertyValue,
  [AST.ValueReference.$type]: (value, ctx) => {
    if (!AST.isPatchedValueReference(value)) {
      return
    }
    const patch = value
    const base = patch.target.ref
    if (AST.isAppVariantDeclaration(patch.$container)) {
      return
    }
    if (!AST.isAliasDeclaration(base)) {
      if (base) {
        ctx.error(configuredValueValidationMessages.patchTarget(patch.target.$refText), patch)
      }
      return
    }
    const baseType = Type.ofValueDeclaration(base)
    if (baseType.kind === 'item' && baseType.item) {
      validateConfiguredItemPatch(patch.patchBlock, baseType.item, ctx)
      return
    }
    const declaration = configuredDeclaration(base.value)
    if (!declaration) {
      ctx.error(configuredValueValidationMessages.patchTarget(base.name), patch)
      return
    }
    validateConfigurationBlock(patch.patchBlock, declaration, ctx, { requireConstructorProperties: false })
  },
} satisfies NodeValidationChecks

/** validateConfiguredValuesFile validates top-level app-variant property patches. */
export function validateConfiguredValuesFile(file: AST.TaoFile, ctx: ValidationContext): void {
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
        validateConfigurationBlock(entry.value.block, declaration, ctx, { requireConstructorProperties: false })
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
  const target = appPropertyTarget(statement.value)
  if (AST.isConfigurableDeclaration(target) || AST.isTypeDeclaration(target)) {
    return AST.isConfigurableDeclaration(target) ? target : undefined
  }
  return AST.isAliasDeclaration(target) ? configuredDeclaration(target.value) : undefined
}

function validateAppPropertyValue(value: AST.AppPropertyValue, ctx: ValidationContext): void {
  const target = appPropertyTarget(value)
  const declaration = AST.isConfigurableDeclaration(target)
    ? target
    : AST.isAliasDeclaration(target)
    ? configuredDeclaration(target.value)
    : undefined
  if (!declaration) {
    return
  }
  if (AST.isAliasDeclaration(target) && !value.block) {
    return
  }
  if (value.block) {
    validateConfigurationBlock(value.block, declaration, ctx, {
      requireConstructorProperties: !AST.isAliasDeclaration(target),
    })
    return
  }
  for (const property of AST.configurationPropertiesOf(declaration)) {
    ctx.error(configuredValueValidationMessages.missingConfiguration(declaration.name, property.name), value)
  }
  if (AST.configurationKeyOf(declaration)) {
    ctx.error(configuredValueValidationMessages.missingKeyedItem(declaration.name), value)
  }
}

function appPropertyTarget(value: AST.AppPropertyValue): AST.NamedDeclaration | undefined {
  return AST.isConfiguredAppPropertyValue(value)
    ? value.target.ref
    : AST.inferredAppPropertyDeclaration(value)
}

function validateConfiguredValue(value: AST.ConfiguredValue, ctx: ValidationContext): void {
  const declaration = value.type.ref
  if (!AST.isConfigurableDeclaration(declaration)) {
    return
  }
  if (!value.block) {
    ctx.error(configuredValueValidationMessages.constructorBlock(declaration.name), value)
    return
  }
  validateConfigurationBlock(value.block, declaration, ctx, { requireConstructorProperties: true })
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

type ConfigurationBlockState = {
  readonly entries: Map<string, AST.ConfigurationEntry>
  readonly keyedContract: AST.ConfigurationKeyDeclaration | undefined
  readonly keyedEntries: Map<string, AST.ConfigurationEntry>
  readonly properties: readonly AST.ConfigurationPropertyDeclaration[]
  readonly propertiesByName: Map<string, AST.ConfigurationPropertyDeclaration>
  readonly typeName: string
}

function validateConfigurationBlock(
  block: AST.ConfigurationBlock,
  declaration: AST.ConfigurableDeclaration,
  ctx: ValidationContext,
  { requireConstructorProperties }: { requireConstructorProperties: boolean },
): void {
  const properties = AST.configurationPropertiesOf(declaration)
  const state: ConfigurationBlockState = {
    typeName: declaration.name,
    properties,
    propertiesByName: new Map(properties.map(property => [property.name, property])),
    keyedContract: AST.configurationKeyOf(declaration),
    entries: new Map(),
    keyedEntries: new Map(),
  }
  validateConfigurationEntries(block, state, ctx)
  for (const required of requireConstructorProperties ? state.properties : []) {
    if (!state.entries.has(required.name)) {
      ctx.error(configuredValueValidationMessages.missingConfiguration(state.typeName, required.name), block)
    }
  }
  if (state.keyedContract) {
    if (requireConstructorProperties && state.keyedEntries.size === 0) {
      ctx.error(configuredValueValidationMessages.missingKeyedItem(state.typeName), block)
    }
    validateConfigurationKeyReferences(block, state, ctx)
  }
}

function validateConfigurationKeyReferences(
  block: AST.ConfigurationBlock,
  state: ConfigurationBlockState,
  ctx: ValidationContext,
): void {
  for (const property of state.properties.filter(AST.configurationPropertyIsKey)) {
    const configuredValues = block.entries
      .filter(entry => entry.name === property.name)
      .map(entry => entry.value)
      .filter(AST.isConfigurationKeyValue)
    for (const configured of configuredValues) {
      if (!state.keyedEntries.has(configured.key)) {
        ctx.error(
          configuredValueValidationMessages.unknownConfigurationKey(state.typeName, property.name, configured.key),
          configured,
        )
      }
    }
  }
}

function validateConfigurationEntries(
  block: AST.ConfigurationBlock,
  state: ConfigurationBlockState,
  ctx: ValidationContext,
): void {
  for (const entry of block.entries) {
    if (entry.key) {
      if (!state.keyedContract) {
        ctx.error(configuredValueValidationMessages.keyedConfiguration(state.typeName), entry)
        continue
      }
      if (state.keyedEntries.has(entry.key)) {
        ctx.error(configuredValueValidationMessages.duplicateConfigurationKey(state.typeName, entry.key), entry)
      }
      state.keyedEntries.set(entry.key, entry)
      validateKeyedConfigurationItem(entry, state.typeName, state.keyedContract, ctx)
      continue
    }
    if (!entry.name || !entry.value) {
      continue
    }
    const property = state.propertiesByName.get(entry.name)
    if (!property) {
      ctx.error(configuredValueValidationMessages.unknownConfiguration(state.typeName, entry.name), entry)
      continue
    }
    if (state.entries.has(entry.name)) {
      ctx.error(configuredValueValidationMessages.duplicateConfiguration(state.typeName, entry.name), entry)
    }
    state.entries.set(entry.name, entry)
    validateConfiguredProperty(entry.value, property, entry, ctx)
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
      ctx.error(configuredValueValidationMessages.keyedItemConfiguration(typeName, key, property.key ?? ''), property)
      continue
    }
    const expected = expectedByName.get(property.name)
    if (!expected) {
      ctx.error(configuredValueValidationMessages.keyedItemConfiguration(typeName, key, property.name), property)
      continue
    }
    if (properties.has(property.name)) {
      ctx.error(
        configuredValueValidationMessages.duplicateConfiguration(`${typeName} item ${key}`, property.name),
        property,
      )
    }
    properties.set(property.name, property)
    validateConfiguredProperty(property.value, expected, property, ctx)
  }
  for (const required of declaration.block.properties) {
    if (!properties.has(required.name)) {
      ctx.error(configuredValueValidationMessages.keyedItemMissing(typeName, key, required.name), entry)
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
      ctx.error(configuredValueValidationMessages.configurationKeyType(property.name), node)
    }
    return
  }
  const actual = configurationValueType(value)
  const expected = Type.ofConfigurationProperty(property)
  if (actual.kind !== 'unresolved' && expected.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      configuredValueValidationMessages.configurationType(
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
    return referencedConfigurationType(value.target.ref)
  }
  if (AST.isConfigurationKeyValue(value) || AST.isPropertyConfigurationPatch(value)) {
    return { kind: 'unresolved' }
  }
  return Type.ofExpression(value)
}
