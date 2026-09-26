import type { ASTUtils } from '@ast-utils'
import { Assert } from '@shared'

/**
 * The store a collection belongs to is decided once for a project and then read from everywhere a
 * query, create, or app binding is compiled. Those emitters are reached through `Compile`, which
 * takes no options of its own, so the plan is scoped to one synchronous module pass the way
 * declaration identity already is.
 */
let activePlan: ASTUtils.DataStorePlan | undefined

/** withDataStorePlan scopes the project's store partition to one synchronous generated module pass. */
export function withDataStorePlan<ResultT>(
  plan: ASTUtils.DataStorePlan | undefined,
  compile: () => ResultT,
): ResultT {
  Assert(activePlan === undefined, 'data store planning is not nested')
  activePlan = plan
  try {
    return compile()
  } finally {
    activePlan = undefined
  }
}

/** activeDataStorePlan returns the partition in scope, absent for a project with no data at all. */
export function activeDataStorePlan(): ASTUtils.DataStorePlan | undefined {
  return activePlan
}

/** activeFixtureStores excludes empty placeholder stores, but includes device-local collections. */
export function activeFixtureStores(): readonly ASTUtils.DataStore[] {
  return activePlan?.stores.filter(store => store.collections.length > 0) ?? []
}
