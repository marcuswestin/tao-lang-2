import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { validateCommandBinding } from './commands-validator'
import { referencedConfigurationType } from './configuration-type'
import { validateConfiguredItemConstruction, validateConfiguredItemPatch } from './configured-item-validator'
import { primitiveSlots } from './workspace-index'

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
  referenceEntry: (surface: string, expected: string) => `${surface} entries must reference ${expected}.`,
  toolbarUnfilled: (name: string, slot: string) => `Toolbar command '${name}' still needs a value for slot '${slot}'.`,
  duplicateReference: (surface: string, kind: string, name: string) =>
    `${surface} references ${kind} '${name}' more than once.`,
  unknownListedDeclaration: (surface: string, name: string) => `${surface} names unknown declaration '${name}'.`,
  listedPatch: (surface: string, name: string) =>
    `${surface} entry '${name}' cannot be derived where it is listed; only a datasource can, so derive this one with a declaration of its own.`,
  datasourceDeclarationRequired: (surface: string, name: string) =>
    `${surface} entry '${name}' must be a \`datasource\` declaration: a bound datasource owns a store, and only a \`datasource\` states which collections it holds.`,
  membershipPatch: (name: string) =>
    `Datasource '${name}' cannot patch Data where it is bound: which collections a datasource stores is structural, not configuration.`,
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
      properties: primitiveSlots(ctx, value.primitive),
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
        ctx.error(patch, configuredValueValidationMessages.patchTarget(patch.target.$refText))
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
      ctx.error(patch, configuredValueValidationMessages.patchTarget(base.name))
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
    ctx.error(value, configuredValueValidationMessages.constructorBlock(declaration.name))
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
      ctx.error(block, configuredValueValidationMessages.missingConfiguration(state.typeName, required.name))
    }
  }
  if (state.keyedContract) {
    if (requireConstructorProperties && state.keyedEntries.size === 0) {
      ctx.error(block, configuredValueValidationMessages.missingKeyedItem(state.typeName))
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
          configured,
          configuredValueValidationMessages.unknownConfigurationKey(state.typeName, property.name, configured.key),
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
        ctx.error(entry, configuredValueValidationMessages.keyedConfiguration(state.typeName))
        continue
      }
      if (state.keyedEntries.has(entry.key)) {
        ctx.error(entry, configuredValueValidationMessages.duplicateConfigurationKey(state.typeName, entry.key))
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
      ctx.error(entry, configuredValueValidationMessages.unknownConfiguration(state.typeName, entry.name))
      continue
    }
    if (state.entries.has(entry.name)) {
      ctx.error(entry, configuredValueValidationMessages.duplicateConfiguration(state.typeName, entry.name))
    }
    state.entries.set(entry.name, entry)
    if (entry.block) {
      validateReferenceBlock(entry.block, property, entry.name, state.typeName, ctx)
      continue
    }
    if (!entry.value) {
      continue
    }
    validateConfiguredProperty(entry.value, property, entry, ctx)
  }
}

/**
 * A brace-initial slot value lists declarations rather than a value, and what it may list is the
 * slot's element type: a configured nav reads the same `Toolbar` slot a scene does, so it lists
 * commands; a datasource's `Data` lists data collections; an app's `Datasource` lists datasources.
 * One rule reads the contract, so a new list-typed slot needs no new validation.
 */
export function validateReferenceBlock(
  block: AST.ConfigurationBlock,
  property: AST.ConfigurationProperty,
  surface: string,
  typeName: string,
  ctx: ValidationContext,
): void {
  const element = referenceBlockElementType(property)
  if (!element) {
    ctx.error(block, configuredValueValidationMessages.configurationBlock(typeName, surface))
    return
  }
  const expected = referenceNoun(element)
  const seen = new Set<AST.Node>()
  for (const entry of block.entries) {
    const listed = ASTUtils.listedEntryOf(entry)
    if (!listed) {
      ctx.error(entry, configuredValueValidationMessages.referenceEntry(surface, `${expected}s`))
      continue
    }
    const reference = listed.target
    if (!reference) {
      // A bare name that does not resolve is already a linking error; a patched one is not linked.
      if (listed.patch) {
        ctx.error(entry, configuredValueValidationMessages.unknownListedDeclaration(surface, listed.name))
      }
      continue
    }
    if (!referenceSatisfiesElement(reference, element)) {
      ctx.error(entry, configuredValueValidationMessages.referenceEntry(surface, `${expected}s`))
      continue
    }
    if (element.kind === 'primitive' && element.primitive === 'datasource' && !AST.isDatasourceDeclaration(reference)) {
      ctx.error(entry, configuredValueValidationMessages.datasourceDeclarationRequired(surface, listed.name))
      continue
    }
    if (seen.has(reference)) {
      ctx.error(entry, configuredValueValidationMessages.duplicateReference(surface, expected, listed.name))
    }
    seen.add(reference)
    if (listed.patch) {
      validateListedPatch(listed.patch, reference, surface, listed.name, ctx)
      continue
    }
    // A listed command must be ready to run: a surface offers a verb, and a verb still missing a
    // value for one of its slots has nothing to offer.
    if (AST.isCommandDeclaration(reference)) {
      const slot = ASTUtils.commandSlots(reference)[0]
      if (slot) {
        ctx.error(entry, configuredValueValidationMessages.toolbarUnfilled(reference.name, slot.name))
      }
    }
  }
}

/**
 * `Personal with { StorageKey "x" }` in a bound set derives that datasource where the app binds it,
 * and the patch is checked against the datasource's own configuration contract exactly as the same
 * `with` would be anywhere else. Membership is the one thing it may not change, because which store
 * holds a collection is decided for the whole project.
 */
function validateListedPatch(
  patch: AST.ConfigurationBlock,
  reference: AST.Node,
  surface: string,
  name: string,
  ctx: ValidationContext,
): void {
  if (!AST.isDatasourceDeclaration(reference)) {
    ctx.error(patch, configuredValueValidationMessages.listedPatch(surface, name))
    return
  }
  const membership = patch.entries.find(entry => entry.name === ASTUtils.datasourceMembershipSlot)
  if (membership) {
    ctx.error(membership, configuredValueValidationMessages.membershipPatch(name))
  }
  const declaration = configuredDeclarationOfValue(reference)
  if (declaration) {
    validateConfigurationBlock(patch, declaration, ctx, { requireConstructorProperties: false })
  }
}

function referenceBlockElementType(property: AST.ConfigurationProperty): ASTUtils.TaoType | undefined {
  const declared = Type.ofConfigurationProperty(property)
  return declared.kind === 'list' ? declared.element : undefined
}

function referenceSatisfiesElement(reference: AST.Node, element: ASTUtils.TaoType): boolean {
  return Type.isAssignable(Type.ofDeclarationFamily(reference), element)
}

function referenceNoun(element: ASTUtils.TaoType): string {
  return element.kind === 'primitive' && element.primitive === 'data'
    ? 'data collection'
    : Type.displayName(element)
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
      ctx.error(property, configuredValueValidationMessages.keyedItemConfiguration(typeName, key, property.key ?? ''))
      continue
    }
    const expected = expectedByName.get(property.name)
    if (!expected) {
      ctx.error(property, configuredValueValidationMessages.keyedItemConfiguration(typeName, key, property.name))
      continue
    }
    if (properties.has(property.name)) {
      ctx.error(
        property,
        configuredValueValidationMessages.duplicateConfiguration(`${typeName} item ${key}`, property.name),
      )
    }
    properties.set(property.name, property)
    validateConfiguredProperty(property.value, expected, property, ctx)
  }
  for (const required of declaration.block.properties) {
    if (required.value === undefined && !properties.has(required.name)) {
      ctx.error(entry, configuredValueValidationMessages.keyedItemMissing(typeName, key, required.name))
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
      ctx.error(node, configuredValueValidationMessages.configurationKeyType(property.name))
    }
    return
  }
  const actual = configurationValueType(value)
  // A member defaulted to `none` is optional, exactly as an optional field is, so a conditional
  // value that may be absent satisfies it. `Datasource datasource is none` in the Prelude is the
  // same shape.
  const expected = configurationPropertyAcceptsAbsence(property)
    ? { kind: 'union' as const, members: [Type.ofConfigurationProperty(property), Type.ofNone()] }
    : Type.ofConfigurationProperty(property)
  if (actual.kind !== 'unresolved' && expected.kind !== 'unresolved' && !Type.isAssignableToSlot(actual, expected)) {
    ctx.error(
      node,
      configuredValueValidationMessages.configurationType(
        property.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
    )
  }
}

/** A member whose declared default is `none` is optional, so absence is one of its legal values. */
function configurationPropertyAcceptsAbsence(property: AST.ConfigurationProperty): boolean {
  return property.value !== undefined && AST.isNoneLiteral(property.value)
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
    ? primitiveSlots(ctx, primitive).filter(property => property.name !== 'implement')
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
