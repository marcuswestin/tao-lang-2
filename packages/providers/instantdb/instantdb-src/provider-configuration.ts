import type TR from '@runtime/TR'
import { Assert } from '@shared/core'

/**
 * Mirrors `packages/apps/stdlib/@tao/data/providers/provider-configuration.ts`, which every other
 * stdlib provider shares directly. `tao-instantdb` cannot depend on `tao-stdlib` without a cycle,
 * since stdlib's own sibling `InstantDB.ts` re-exports this package, so this copy names its
 * original and the two stay in step.
 */

/** requiredConfigurationText reads a text property the datasource declaration requires. */
export function requiredConfigurationText(
  provider: string,
  context: TR.DataProviderContext,
  name: string,
): string {
  const value = context.configuration[name]
  Assert.input(
    typeof value === 'string' && value.trim().length > 0,
    `${provider} datasource configuration '${name}' expects non-empty text.`,
  )
  return value.trim()
}

/** optionalConfigurationText reads a text property the datasource declaration marks optional. */
export function optionalConfigurationText(
  provider: string,
  context: TR.DataProviderContext,
  name: string,
): string | undefined {
  const value = context.configuration[name]
  if (value === undefined) {
    return undefined
  }
  Assert.input(
    typeof value === 'string' && value.trim().length > 0,
    `${provider} datasource configuration '${name}' expects non-empty text when provided.`,
  )
  return value.trim()
}
