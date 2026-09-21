import { AST } from '@parser'
import { Type } from './Type'

/**
 * ResolvedDatasource is what a bound datasource actually is, after following its derivation: which
 * types it is built from, and the literal configuration those types and their patches settle on.
 *
 * The ship pipeline is the caller that needs this. Which provider an app mounts decides the
 * entitlements, the manifest, and whether the app may ship at all, and reading it from the resolved
 * value rather than from the source text is what lets a variant, a named declaration, a reusable
 * type, and a patch all be understood as the one binding they are.
 */
export type ResolvedDatasource = {
  /** configuration holds the literal values the chain settles on, nearest derivation winning. */
  readonly configuration: ReadonlyMap<string, string>
  /** typeNames are the configuration types in the chain, nearest first, ending at the provider type. */
  readonly typeNames: readonly string[]
}

/**
 * resolveDatasourceValue follows a datasource value's derivation to its provider type and
 * configuration. `patches` are the slot patches laid over it where it is bound — `Datasource with
 * { … }` in a variant, and an app's `configure` entry — which keep the base's provider and settle
 * the configuration last.
 */
export function resolveDatasourceValue(
  value: AST.Expression | AST.ConfigurationValue,
  patches: readonly AST.ConfigurationBlock[] = [],
): ResolvedDatasource {
  const resolved = resolveValue(value, new Set())
  for (const patch of patches) {
    applyBlock(resolved, patch, new Set())
  }
  return { configuration: resolved.configuration, typeNames: resolved.typeNames }
}

type MutableResolution = {
  configuration: Map<string, string>
  typeNames: string[]
}

function emptyResolution(): MutableResolution {
  return { configuration: new Map(), typeNames: [] }
}

function resolveValue(
  value: AST.Expression | AST.ConfigurationValue,
  seen: Set<AST.Node>,
): MutableResolution {
  if (AST.isPropertyConfigurationPatch(value)) {
    const resolution = emptyResolution()
    applyBlock(resolution, value.block, seen)
    return resolution
  }
  if (AST.isConfigurationReference(value)) {
    return resolveDeclaration(value.target.ref, seen)
  }
  if (!AST.isExpression(value)) {
    return emptyResolution()
  }
  if (AST.isConfigurationConstructor(value)) {
    const resolution = resolveDeclaration(value.type.ref, seen)
    if (value.block) {
      applyBlock(resolution, value.block, seen)
    }
    return resolution
  }
  if (AST.isPrimitiveConfigurationConstructor(value) || AST.isInferredConfigurationConstructor(value)) {
    const resolution = emptyResolution()
    applyBlock(resolution, value.block, seen)
    return resolution
  }
  if (AST.isValueReference(value) || AST.isRefinementExpression(value)) {
    const resolution = resolveDeclaration(value.target.ref, seen)
    if (AST.isRefinementExpression(value)) {
      applyBlock(resolution, value.patchBlock, seen)
    }
    return resolution
  }
  return emptyResolution()
}

function resolveDeclaration(declaration: AST.Node | undefined, seen: Set<AST.Node>): MutableResolution {
  if (!declaration || seen.has(declaration)) {
    return emptyResolution()
  }
  seen.add(declaration)
  if (AST.isDatasourceDeclaration(declaration)) {
    const resolution = declaration.value ? resolveValue(declaration.value, seen) : emptyResolution()
    // `datasource X { … }` writes its block directly rather than through a value.
    if (declaration.block) {
      applyBlock(resolution, declaration.block, seen)
    }
    return resolution
  }
  if (AST.isAliasDeclaration(declaration)) {
    return declaration.value ? resolveValue(declaration.value, seen) : emptyResolution()
  }
  if (AST.isTypeDeclaration(declaration)) {
    return resolveTypeDeclaration(declaration, seen)
  }
  return emptyResolution()
}

/**
 * A reusable type both names the provider and may fill slots of its own, so a type chain contributes
 * its base's names and then its own defaults over them.
 */
function resolveTypeDeclaration(declaration: AST.TypeDeclaration, seen: Set<AST.Node>): MutableResolution {
  const resolution = emptyResolution()
  const type = declaration.type
  if (type && AST.isDerivedTypeExpression(type) && AST.isNamedTypeReference(type.base)) {
    const base = resolveDeclaration(Type.definitionOfReference(type.base), seen)
    resolution.typeNames.push(...base.typeNames)
    for (const [name, value] of base.configuration) {
      resolution.configuration.set(name, value)
    }
  }
  resolution.typeNames.unshift(declaration.name)
  for (const property of AST.configurationPropertiesOf(declaration)) {
    const literal = 'value' in property && property.value ? literalText(property.value) : undefined
    if (literal !== undefined) {
      resolution.configuration.set(property.name, literal)
    }
  }
  return resolution
}

function applyBlock(resolution: MutableResolution, block: AST.ConfigurationBlock, seen: Set<AST.Node>): void {
  for (const entry of block.entries) {
    if (!entry.name || !entry.value) {
      continue
    }
    if (AST.isPropertyConfigurationPatch(entry.value)) {
      applyBlock(resolution, entry.value.block, seen)
      continue
    }
    const literal = literalText(entry.value)
    if (literal !== undefined) {
      resolution.configuration.set(entry.name, literal)
    }
  }
}

/** literalText reads a configured value written as a plain literal; anything else has no ship meaning. */
function literalText(value: AST.Expression | AST.ConfigurationValue): string | undefined {
  if (!AST.isExpression(value)) {
    return undefined
  }
  if (AST.isStringLiteral(value)) {
    return value.value
  }
  return AST.isNumberLiteral(value) ? String(value.value) : undefined
}
