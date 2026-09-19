import { AST } from '@parser'
import { Type } from './Type'

/**
 * A store is one mounted catalog: a set of data collections, one schema, one connection. Which
 * store a collection belongs to is a fact about the project, not about an app — the same query
 * compiles once and every app that runs it reads the same store — so the partition is computed from
 * the `Data` slots of the project's `datasource` declarations, and apps only choose which
 * datasource fills each store.
 */
export type DataStoreKind = 'default' | 'device' | 'named'

export type DataStore = {
  /** binding is the generated schema binding this store is emitted as. */
  readonly binding: string
  readonly collections: readonly AST.EntityDataDeclaration[]
  /**
   * datasources are the declarations claiming exactly this store. More than one means they are
   * alternatives — a stub or preview standing in for the real one — and an app binds one of them.
   */
  readonly datasources: readonly AST.DatasourceDeclaration[]
  readonly kind: DataStoreKind
  /** name is the schema name, which is also the storage key a provider defaults to. */
  readonly name: string
}

export type DataStorePlan = {
  /** defaultStore holds every collection no `Data` slot claims, and is absent when none is left. */
  readonly defaultStore: DataStore | undefined
  readonly deviceStore: DataStore | undefined
  readonly stores: readonly DataStore[]
}

/**
 * datasourceMembershipSlot is the Prelude slot a datasource states its membership in. It is
 * structural rather than configuration: the compiler partitions the catalog with it and never
 * carries it across the provider boundary, because no provider has anything to do with it.
 */
export const datasourceMembershipSlot = 'Data'

const defaultStoreName = 'Data'
const deviceStoreName = 'LocalData'
const defaultStoreBinding = '_TaoDataCatalog'
const deviceStoreBinding = '_TaoLocalDataCatalog'

/**
 * planDataStores partitions a project's collections into the stores its datasources declare.
 *
 * The device store comes first because `local only` is the narrow form of the same fact and is
 * decided on the entity rather than the datasource. Every other claimed collection follows its
 * `Data` slot, and whatever is left is the default store — which is the whole catalog for the
 * ordinary app that declares one datasource and no membership at all.
 */
export function planDataStores(
  collections: readonly AST.EntityDataDeclaration[],
  datasources: readonly AST.DatasourceDeclaration[],
): DataStorePlan {
  const device = collections.filter(Type.dataEntityIsLocalOnly)
  const claimable = collections.filter(collection => !Type.dataEntityIsLocalOnly(collection))
  const claimed = new Set<AST.EntityDataDeclaration>()
  const named: DataStore[] = []
  for (const group of groupDatasourcesByClaim(datasources, claimable)) {
    for (const collection of group.collections) {
      claimed.add(collection)
    }
    named.push({
      binding: `${defaultStoreBinding}_${group.name}`,
      collections: group.collections,
      datasources: group.datasources,
      kind: 'named',
      name: group.name,
    })
  }
  const unclaimed = claimable.filter(collection => !claimed.has(collection))
  // A project whose datasources claim everything has no default store; one that claims nothing —
  // every app in the repository today — has only the default store, emitted exactly as before.
  const defaultStore: DataStore | undefined = unclaimed.length > 0 || named.length === 0
    ? {
      binding: defaultStoreBinding,
      collections: unclaimed,
      datasources: datasources.filter(datasource => datasourceCollectionNames(datasource) === undefined),
      kind: 'default',
      name: defaultStoreName,
    }
    : undefined
  const deviceStore: DataStore | undefined = device.length > 0
    ? {
      binding: deviceStoreBinding,
      collections: device,
      datasources: [],
      kind: 'device',
      name: deviceStoreName,
    }
    : undefined
  return {
    defaultStore,
    deviceStore,
    stores: [...defaultStore ? [defaultStore] : [], ...named, ...deviceStore ? [deviceStore] : []],
  }
}

/** storeOfCollection returns the store that holds one collection's rows. */
export function storeOfCollection(
  plan: DataStorePlan,
  collection: AST.EntityDataDeclaration,
): DataStore | undefined {
  return plan.stores.find(store => store.collections.includes(collection))
}

/** storeOfDatasource returns the store a named datasource declaration claims. */
export function storeOfDatasource(
  plan: DataStorePlan,
  datasource: AST.DatasourceDeclaration,
): DataStore | undefined {
  return plan.stores.find(store => store.datasources.includes(datasource))
}

/**
 * datasourceDataEntry returns the `Data` membership entry that governs one datasource declaration.
 * Membership is structural, so a datasource derived from another with `with` stores exactly what its
 * base stores: it is an alternative for the base's store, which is what a preview or stub is, and it
 * never becomes a catch-all by losing the base's membership. Its own patch may not restate `Data`.
 */
export function datasourceDataEntry(
  datasource: AST.DatasourceDeclaration,
  seen: Set<AST.DatasourceDeclaration> = new Set(),
): AST.ConfigurationEntry | undefined {
  if (seen.has(datasource)) {
    return undefined
  }
  seen.add(datasource)
  const base = derivedDatasourceBase(datasource)
  if (base) {
    return datasourceDataEntry(base, seen)
  }
  return ownConfigurationBlock(datasource)?.entries.find(entry => entry.name === datasourceMembershipSlot)
}

/** derivedDatasourceBase returns the datasource declaration a `with` derivation starts from. */
export function derivedDatasourceBase(datasource: AST.DatasourceDeclaration): AST.DatasourceDeclaration | undefined {
  const value = datasource.value
  const target = value && AST.isRefinementExpression(value) ? value.target.ref : undefined
  return target && AST.isDatasourceDeclaration(target) ? target : undefined
}

/**
 * datasourceCollectionNames returns the collection names one datasource claims, or undefined when
 * it declares no membership at all and is therefore the catch-all for its app.
 */
export function datasourceCollectionNames(
  datasource: AST.DatasourceDeclaration,
): readonly string[] | undefined {
  const entry = datasourceDataEntry(datasource)
  if (!entry?.block) {
    return undefined
  }
  return entry.block.entries.flatMap(member => member.reference ? [member.reference.$refText] : [])
}

/** datasourceCollections resolves the collections one datasource claims against a catalog. */
export function datasourceCollections(
  datasource: AST.DatasourceDeclaration,
  collections: readonly AST.EntityDataDeclaration[],
): readonly AST.EntityDataDeclaration[] | undefined {
  const names = datasourceCollectionNames(datasource)
  if (!names) {
    return undefined
  }
  return collections.filter(collection => names.includes(collection.name))
}

/** ownConfigurationBlock returns the block a declaration writes itself, construction or patch. */
export function ownConfigurationBlock(
  datasource: AST.DatasourceDeclaration,
): AST.ConfigurationBlock | undefined {
  if (datasource.block) {
    return datasource.block
  }
  const value = datasource.value
  if (!value) {
    return undefined
  }
  if (AST.isRefinementExpression(value)) {
    return value.patchBlock
  }
  if (
    AST.isConfigurationConstructor(value)
    || AST.isPrimitiveConfigurationConstructor(value)
    || AST.isInferredConfigurationConstructor(value)
  ) {
    return value.block
  }
  return undefined
}

type DatasourceClaim = {
  readonly collections: readonly AST.EntityDataDeclaration[]
  readonly datasources: readonly AST.DatasourceDeclaration[]
  readonly name: string
}

/**
 * Datasources claiming the same collections are alternatives for one store, which is what a preview
 * or stub variant is. A store is named by the collections it holds, sorted, never by the datasources
 * that fill it: adding an alternative, renaming one, or reordering declarations leaves the store and
 * every storage key defaulted from it untouched, and only a change to what the store holds — which
 * changes the store anyway — gives it a new name. Length-prefixed parts are structural: collection
 * sets such as `A_B, C` and `A, B_C` cannot collapse onto the same generated identity.
 */
function groupDatasourcesByClaim(
  datasources: readonly AST.DatasourceDeclaration[],
  collections: readonly AST.EntityDataDeclaration[],
): readonly DatasourceClaim[] {
  const groups = new Map<
    string,
    { collections: AST.EntityDataDeclaration[]; datasources: AST.DatasourceDeclaration[] }
  >()
  for (const datasource of datasources) {
    const claimed = datasourceCollections(datasource, collections)
    if (!claimed || claimed.length === 0) {
      continue
    }
    const collectionNames = claimed.map(collection => collection.name).toSorted()
    // Keep the established one-collection public name. `$` cannot occur in a Tao identifier, so a
    // multi-collection structural spelling cannot alias any authored single collection name.
    const name = collectionNames.length === 1
      ? collectionNames[0]!
      : `$${collectionNames.map(collectionName => `${collectionName.length}_${collectionName}`).join('')}`
    const group = groups.get(name) ?? { collections: [...claimed], datasources: [] }
    group.datasources.push(datasource)
    groups.set(name, group)
  }
  return [...groups.entries()]
    .map(([name, group]) => ({ collections: group.collections, datasources: group.datasources, name }))
    .toSorted((left, right) => left.name.localeCompare(right.name))
}
