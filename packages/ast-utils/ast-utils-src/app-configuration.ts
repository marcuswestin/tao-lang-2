import { AST } from '@parser'
import { Type } from './Type'

/** AppPropertySource is one supplied app slot value; a root `view` statement supplies Navigator as sugar. */
export type AppPropertySource = AST.Expression | AST.ConfigurationValue | AST.AppView

/** EffectiveAppProperty is one slot's base value plus the patches an app or variant lays over it. */
export type EffectiveAppProperty = {
  /** block is the reference block a list-typed slot supplies instead of a value. */
  block?: AST.ConfigurationBlock
  patches: AST.ConfigurationBlock[]
  value?: AppPropertySource
}

export type EffectiveAppConfiguration = Map<string, EffectiveAppProperty>

/**
 * effectiveAppConfiguration resolves what an app value actually supplies, following the derivation
 * chain through type defaults, construction blocks, variant refinements, and property patches. It
 * is shared because the validator and the compiler must agree on it exactly: a diagnostic about a
 * slot a variant never reaches, or generated code binding a datasource the validator never checked,
 * are the same bug seen from two sides.
 */
export function effectiveAppConfiguration(
  declaration: AST.AppValueDeclaration,
  seen: Set<AST.AppValueDeclaration> = new Set(),
): EffectiveAppConfiguration {
  if (seen.has(declaration)) {
    return new Map()
  }
  seen.add(declaration)
  if (AST.isAppDeclaration(declaration) && declaration.block) {
    const configuration: EffectiveAppConfiguration = new Map()
    const rootView = AST.blockStatements(declaration).find(AST.isAppView)
    if (rootView) {
      configuration.set('Navigator', { patches: [], value: rootView })
    }
    for (const property of AST.blockStatements(declaration).filter(AST.isAppProperty)) {
      if (property.patch) {
        applyAppPropertyPatch(configuration, property.name, property.patch.block)
      } else if (property.value) {
        const references = referenceBlockOf(property.value)
        configuration.set(
          property.name,
          references ? { block: references, patches: [] } : { patches: [], value: property.value },
        )
      }
    }
    return configuration
  }
  const expression = declaration.value
  return expression ? effectiveAppExpression(expression, seen) : new Map()
}

function effectiveAppExpression(
  expression: AST.Expression,
  seen: Set<AST.AppValueDeclaration>,
): EffectiveAppConfiguration {
  if (AST.isPrimitiveConfigurationConstructor(expression)) {
    const configuration: EffectiveAppConfiguration = new Map()
    applyConfigurationBlock(configuration, expression.block)
    return configuration
  }
  if (AST.isConfigurationConstructor(expression)) {
    const declaration = expression.type.ref
    const configuration = declaration && AST.isConfigurableDeclaration(declaration)
      ? configurationDefaults(declaration)
      : new Map<string, EffectiveAppProperty>()
    if (expression.block) {
      applyConfigurationBlock(configuration, expression.block)
    }
    return configuration
  }
  if (AST.isInferredConfigurationConstructor(expression)) {
    const owner = expression.$container
    const declaration = AST.isAliasDeclaration(owner) ? Type.visibleDeclaration(owner, owner.name) : undefined
    const configuration = declaration && AST.isConfigurableDeclaration(declaration)
      ? configurationDefaults(declaration)
      : new Map<string, EffectiveAppProperty>()
    applyConfigurationBlock(configuration, expression.block)
    return configuration
  }
  if (AST.isRefinementExpression(expression) || AST.isValueReference(expression)) {
    const target = expression.target.ref
    if (!target || !AST.isAppValueDeclaration(target)) {
      return new Map()
    }
    const configuration = effectiveAppConfiguration(target, seen)
    if (AST.isRefinementExpression(expression)) {
      applyConfigurationBlock(configuration, expression.patchBlock)
    }
    return configuration
  }
  return new Map()
}

function configurationDefaults(declaration: AST.ConfigurableDeclaration): EffectiveAppConfiguration {
  const configuration: EffectiveAppConfiguration = new Map()
  for (const property of AST.configurationPropertiesOf(declaration)) {
    if ('value' in property && property.value) {
      configuration.set(property.name, { patches: [], value: property.value })
    }
  }
  return configuration
}

function applyConfigurationBlock(
  configuration: EffectiveAppConfiguration,
  block: AST.ConfigurationBlock,
): void {
  for (const entry of block.entries) {
    // `view Shell(Other)` in a variant rebinds the root view, which is the Navigator slot's sugar.
    if (entry.rootView) {
      configuration.set('Navigator', { patches: [], value: entry.rootView })
      continue
    }
    if (!entry.name) {
      continue
    }
    if (entry.block) {
      configuration.set(entry.name, { block: entry.block, patches: [] })
      continue
    }
    if (!entry.value) {
      continue
    }
    if (AST.isPropertyConfigurationPatch(entry.value)) {
      applyAppPropertyPatch(configuration, entry.name, entry.value.block)
    } else {
      configuration.set(entry.name, { patches: [], value: entry.value })
    }
  }
}

/**
 * ListedEntry is one entry of a reference block read as the declaration it names. A bare name lists
 * the declaration itself; `Personal with { … }` lists it derived where it is listed, the one
 * refinement the language has, applied at the binding rather than in a separate override block.
 */
export type ListedEntry = {
  readonly entry: AST.ConfigurationEntry
  readonly name: string
  /** patch is the refinement written on the listed name, absent for a bare name. */
  readonly patch?: AST.ConfigurationBlock
  /** target is the declaration the name resolves to, absent when nothing visible carries it. */
  readonly target: AST.Node | undefined
}

/**
 * listedEntryOf reads one block entry as a listed declaration, or returns undefined for an entry that
 * constructs a value instead. A patched name parses as an ordinary `Name with { … }` slot entry,
 * because at parse time a reference block and a construction block look alike, so its target is found
 * by name among the declarations visible where it is written.
 */
export function listedEntryOf(entry: AST.ConfigurationEntry): ListedEntry | undefined {
  if (entry.reference) {
    return { entry, name: entry.reference.$refText, target: entry.reference.ref }
  }
  if (!entry.name || entry.nameMembers.length > 0 || !entry.value || !AST.isPropertyConfigurationPatch(entry.value)) {
    return undefined
  }
  const name = entry.name
  const target = AST.visibleFileDeclarations(entry, AST.isDeclaration).find(declaration => declaration.name === name)
  return { entry, name, patch: entry.value.block, target }
}

/**
 * referenceBlockOf reads a brace block in slot position as the list of declarations it names.
 *
 * A block of listed names is a list — `Toolbar { Save }`, `Data { Stories }`, `Datasource { News,
 * Personal with { StorageKey "x" } }` — while a block of `Name value` pairs constructs a value, which
 * is what an app slot's bare block has always meant. The entries decide, so neither reading depends
 * on what type happens to share the slot's name.
 */
export function referenceBlockOf(value: AppPropertySource): AST.ConfigurationBlock | undefined {
  if (AST.isAppView(value) || !AST.isExpression(value) || !AST.isInferredConfigurationConstructor(value)) {
    return undefined
  }
  const entries = value.block.entries
  // An empty block keeps its older reading as a construction with everything defaulted; a slot that
  // should list nothing is left out instead. Every entry must have a listed shape, and something must
  // mark the block as a list: a bare name, or a patched name that resolves to a declaration, which a
  // slot being patched inside a construction block never does. Once it is a list, a patched name that
  // resolves to nothing is reported as unknown rather than silently reread as a construction.
  const listed = entries.map(listedEntryOf)
  const shaped = entries.length > 0 && listed.every(item => item !== undefined)
  const marked = listed.some(item => item !== undefined && (item.patch === undefined || item.target !== undefined))
  return shaped && marked ? value.block : undefined
}

function applyAppPropertyPatch(
  configuration: EffectiveAppConfiguration,
  name: string,
  patch: AST.ConfigurationBlock,
): void {
  const property = configuration.get(name)
  if (!property) {
    return
  }
  property.patches.push(patch)
}

/**
 * appBoundDatasources resolves the datasources an app mounts. A slot supplying one value binds one
 * datasource; a reference block binds the set it lists. An inline construction (`Datasource Dev { }`)
 * binds a datasource that has no declaration of its own, so it claims no membership and holds the
 * whole catalog.
 */
export function appBoundDatasources(app: AST.AppValueDeclaration): readonly AppDatasourceBinding[] {
  const slot = effectiveAppConfiguration(app).get('Datasource')
  if (!slot) {
    return []
  }
  if (slot.block) {
    return slot.block.entries.flatMap(entry => {
      const listed = listedEntryOf(entry)
      const target = listed?.target
      return target && AST.isDatasourceDeclaration(target)
        ? [{ declaration: target, node: entry, patches: [...slot.patches, ...listed.patch ? [listed.patch] : []] }]
        : []
    })
  }
  const value = slot.value
  if (!value || AST.isAppView(value) || (AST.isExpression(value) && AST.isNoneLiteral(value))) {
    return []
  }
  return [{ declaration: datasourceDeclarationOfValue(value), node: value, patches: slot.patches, value }]
}

/** AppDatasourceBinding is one datasource an app mounts, with the node that named it. */
export type AppDatasourceBinding = {
  /** declaration is the named `datasource` this binding resolves to, absent for an inline value. */
  readonly declaration?: AST.DatasourceDeclaration
  readonly node: AST.Node
  readonly patches: readonly AST.ConfigurationBlock[]
  readonly value?: AppPropertySource
}

function datasourceDeclarationOfValue(value: AppPropertySource): AST.DatasourceDeclaration | undefined {
  if (AST.isAppView(value) || !AST.isExpression(value)) {
    return undefined
  }
  if (AST.isValueReference(value) || AST.isRefinementExpression(value)) {
    const target = value.target.ref
    return target && AST.isDatasourceDeclaration(target) ? target : undefined
  }
  return undefined
}
