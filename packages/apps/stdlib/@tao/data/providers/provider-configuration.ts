import type TR from '@runtime/TR'
import { Assert } from '@shared/core'

/**
 * A datasource's declared properties reach its provider as an evaluated configuration record. These
 * readers check the text properties the shipped providers declare, so every provider reports a
 * malformed value in the same sentence naming the datasource and the property.
 */

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
