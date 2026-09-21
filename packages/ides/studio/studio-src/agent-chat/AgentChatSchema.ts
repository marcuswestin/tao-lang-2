import { jsonSchema } from 'ai'

/** objectSchema declares one tool's input as a closed object with the given required keys. */
export function objectSchema<Input>(properties: Record<string, unknown>, required: readonly string[]) {
  return jsonSchema<Input>({ additionalProperties: false, properties, required: [...required], type: 'object' })
}

/** TEXT is a described string property. */
export const TEXT = (description: string) => ({ description, type: 'string' })

/** LIST is a described list-of-strings property. */
export const LIST = (description: string) => ({ description, items: { type: 'string' }, type: 'array' })

/**
 * refusal is how a tool says no. The model reads it and adapts; nothing throws, because a thrown tool is a
 * dead turn rather than a correction. `known` is capped so a refusal never dumps a whole project's names.
 */
export function refusal(
  message: string,
  extra: Record<string, unknown> & { known?: readonly string[] } = {},
): Record<string, unknown> {
  const { known, ...rest } = extra
  return { refused: message, ...rest, ...(known === undefined ? {} : { known: known.slice(0, 40) }) }
}
