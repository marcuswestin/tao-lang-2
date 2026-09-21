/** The TypeScript side of `@tao/text`. Each export is named, and Tao states the types. */

/**
 * Counts Unicode-whitespace-delimited words after trimming leading and trailing whitespace. The
 * empty string and an all-whitespace string both contain zero words.
 */
export const CountWords = (value: string): number => {
  const trimmed = value.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length
}

/**
 * Joins text values in source order, inserting the separator between adjacent values and nowhere
 * else. An empty list returns empty text, and a one-item list returns that item unchanged.
 */
export const Join = (values: readonly string[], separator: string): string => values.join(separator)
