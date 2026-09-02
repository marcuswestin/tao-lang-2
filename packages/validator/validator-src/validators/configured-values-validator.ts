import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { validateCommandBinding } from './commands-validator'
import { referencedConfigurationType } from './configuration-type'
import { validateConfiguredItemConstruction, validateConfiguredItemPatch } from './configured-item-validator'

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
  configurationBlock: (type: string, name: string) =>
    `${type} configuration '${name}' expects a value expression, not a reference block.`,
  toolbarReference: 'Toolbar entries must reference commands.',
  toolbarUnfilled: (name: string, slot: string) => `Toolbar command '${name}' still needs a value for slot '${slot}'.`,
  duplicateToolbarReference: (name: string) => `Toolbar references command '${name}' more than once.`,
} as const

export const configuredValueValidationChecks = {
  [AST.ConfiguredValue.$type]: validateConfiguredValue,
  [AST.InferredConfigurationConstructor.$type]: (value, ctx) => {
    const declaration = Type.inferredConfigurationDeclaration(value)
    if (declaration && AST.isConfigurableDeclaration(declaration)) {
      validateConfigurationBlock(value.block, declaration, ctx, { requireConstructorProperties: true })
    }
  },
  [AST.PrimitiveConfigurationConstructor.$type]: (value, ctx) => {
    validateConfiguredItemConstruction(value.block, {
      properties: AST.primitiveSlots(ctx.workspaceFiles, value.primitive),
    }, ctx)
  },
  [AST.RefinementExpression.$type]: (value, ctx) => {
    const patch = value
    const base = patch.target.ref
    if (AST.isCommandDeclaration(base)) {
      validateCommandBinding(base, patch.patchBlock, ctx)
      return
    }
    if (AST.isConcreteAppValueDeclaration(patch.$container)) {
      return
    }
    if (AST.isTypeDeclaration(base)) {
      if (AST.isConfigurableDeclaration(base)) {
        validateConfigurationBlock(patch.patchBlock, base, ctx, { requireConstructorProperties: true })
      } else {
        const baseType = Type.ofDefinition(base)
        const slots = Type.slotsOf(baseType)
        if (slots) {
          validateConfiguredItemPatch(patch.patchBlock, slots, ctx)
        }
      }
      return
    }
    if (!AST.isAliasDeclaration(base) && !AST.isNavDeclaration(base) && !AST.isDatasourceDeclaration(base)) {
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
    const declaration = configuredDeclarationOfValue(base)
    if (!declaration) {
      ctx.error(configuredValueValidationMessages.patchTarget(base.name), patch)
      return
    }
    validateConfigurationBlock(patch.patchBlock, declaration, ctx, { requireConstructorProperties: false })
  },
} satisfies NodeValidationChecks

/** validateConfiguredValuesFile validates top-level app-variant property patches. */
export function validateConfiguredValuesFile(file: AST.TaoFile, ctx: ValidationContext): void {
  void file
  void ctx
}

function validateConfiguredValue(value: AST.ConfiguredValue, ctx: ValidationContext): void {
  const declaration = value.type.ref
  if (!declaration || !AST.isConfigurableDeclaration(declaration)) {
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
    const target = value.type.ref
    return target && AST.isConfigurableDeclaration(target) ? target : undefined
  }
  if (AST.isRefinementExpression(value) || AST.isValueReference(value)) {
    const base = value.target.ref
    if (base && AST.isConfigurableDeclaration(base)) {
      return base
    }
    if (AST.isNavDeclaration(base) || AST.isDatasourceDeclaration(base) || AST.isAppDeclaration(base)) {
      return configuredDeclarationOfValue(base)
    }
    if (!AST.isAliasDeclaration(base) || seen.has(base)) {
      return undefined
    }
    seen.add(base)
    return configuredDeclaration(base.value, seen)
  }
  return undefined
}

function configuredDeclarationOfValue(value: AST.ValueDeclaration): AST.ConfigurableDeclaration | undefined {
  if (AST.isNavDeclaration(value) || AST.isDatasourceDeclaration(value) || AST.isAppDeclaration(value)) {
    return value.value ? configuredDeclaration(value.value) : undefined
  }
  return AST.isAliasDeclaration(value) ? configuredDeclaration(value.value) : undefined
}

type ConfigurationBlockState = {
  readonly entries: Map<string, AST.ConfigurationEntry>
  readonly keyedContract: AST.ConfigurationKeyDeclaration | undefined
  readonly keyedEntries: Map<string, AST.ConfigurationEntry>
  readonly properties: readonly AST.ConfigurationProperty[]
  readonly propertiesByName: Map<string, AST.ConfigurationProperty>
  readonly typeName: string
}

function validateConfigurationBlock(
  block: AST.ConfigurationBlock,
  declaration: AST.ConfigurableDeclaration,
  ctx: ValidationContext,
  { requireConstructorProperties }: { requireConstructorProperties: boolean },
): void {
  const properties = effectiveConfigurationProperties(declaration, ctx)
  const state: ConfigurationBlockState = {
    typeName: declaration.name,
    properties,
    propertiesByName: new Map(properties.map(property => [property.name, property])),
    keyedContract: AST.configurationKeyOf(declaration),
    entries: new Map(),
    keyedEntries: new Map(),
  }
  validateConfigurationEntries(block, state, ctx)
  for (
    const required of requireConstructorProperties
      ? state.properties.filter(configurationPropertyRequiresValue)
      : []
  ) {
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
    if (!entry.name) {
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
    if (entry.block) {
      if (entry.name === 'Toolbar') {
        validateToolbarReferenceBlock(entry.block, ctx)
      } else {
        ctx.error(configuredValueValidationMessages.configurationBlock(state.typeName, entry.name), entry.block)
      }
      continue
    }
    if (!entry.value) {
      continue
    }
    validateConfiguredProperty(entry.value, property, entry, ctx)
  }
}

/**
 * A configured nav reads the same `Toolbar` slot a scene does, so it lists the same thing: commands.
 * There is no second toolbar vocabulary — an action has no title of its own to show.
 */
function validateToolbarReferenceBlock(block: AST.ConfigurationBlock, ctx: ValidationContext): void {
  const seen = new Set<AST.CommandDeclaration>()
  for (const entry of block.entries) {
    const reference = entry.reference?.ref
    if (!reference) {
      if (!entry.reference) {
        ctx.error(configuredValueValidationMessages.toolbarReference, entry)
      }
      continue
    }
    if (!AST.isCommandDeclaration(reference)) {
      ctx.error(configuredValueValidationMessages.toolbarReference, entry)
      continue
    }
    if (seen.has(reference)) {
      ctx.error(configuredValueValidationMessages.duplicateToolbarReference(reference.name), entry)
    }
    seen.add(reference)
    const slot = ASTUtils.commandSlots(reference)[0]
    if (slot) {
      ctx.error(configuredValueValidationMessages.toolbarUnfilled(reference.name, slot.name), entry)
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
    if (required.value === undefined && !properties.has(required.name)) {
      ctx.error(configuredValueValidationMessages.keyedItemMissing(typeName, key, required.name), entry)
    }
  }
}

function validateConfiguredProperty(
  value: AST.ConfigurationValue,
  property: AST.ConfigurationProperty,
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

function configurationPropertyRequiresValue(property: AST.ConfigurationProperty): boolean {
  return AST.isTypeProperty(property) ? Type.propertyRequiresValue(property) : property.value === undefined
}

function effectiveConfigurationProperties(
  declaration: AST.ConfigurableDeclaration,
  ctx: ValidationContext,
): AST.ConfigurationProperty[] {
  const primitive = AST.configurationPrimitiveOf(declaration)
  const properties: AST.ConfigurationProperty[] = primitive
    ? AST.primitiveSlots(ctx.workspaceFiles, primitive).filter(property => property.name !== 'implement')
    : []
  for (const property of AST.configurationPropertiesOf(declaration)) {
    const index = properties.findIndex(candidate => candidate.name === property.name)
    if (index === -1) {
      properties.push(property)
    } else {
      properties[index] = property
    }
  }
  return properties
}

function configurationValueType(value: AST.ConfigurationValue): ASTUtils.TaoType {
  if (AST.isViewBinding(value)) {
    return { kind: 'primitive', primitive: 'view' }
  }
  if (AST.isConfigurationReference(value)) {
    return referencedConfigurationType(value.target.ref)
  }
  if (AST.isConfigurationKeyValue(value) || AST.isPropertyConfigurationPatch(value)) {
    return { kind: 'unresolved' }
  }
  return Type.ofExpression(value)
}
