import type { GenerationInput, JsonValue } from './generation-contract'

/** generationPrompt renders the guide and the named inputs as the one prompt every provider sends. */
export function generationPrompt(inputs: readonly GenerationInput[], guide: string): string {
  return [
    guide,
    'Generate one value matching the supplied schema from these explicitly provided inputs:',
    JSON.stringify(Object.fromEntries(inputs.map(input => [input.name, input.value]))),
  ].join('\n\n')
}

/**
 * parseJsonText reads the JSON a text-first model returns: fenced or bare, possibly wrapped in prose.
 * It returns undefined when no JSON object or array can be found.
 */
export function parseJsonText(text: string): JsonValue | undefined {
  const unfenced = text.replace(/```(?:json)?/giu, '')
  const candidates = [unfenced.trim(), sliceBetween(unfenced, '{', '}'), sliceBetween(unfenced, '[', ']')]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) {
      continue
    }
    try {
      return JSON.parse(candidate) as JsonValue
    } catch {
      // Try the next, narrower candidate.
    }
  }
  return undefined
}

/** emptyPartials is the partial stream of a provider that answers only once, at the end. */
export function emptyPartials<Value>(): AsyncIterable<Value> {
  return {
    async *[Symbol.asyncIterator]() {
      // A text-first model has no structured partial to stream.
    },
  }
}

function sliceBetween(text: string, open: string, close: string): string | undefined {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined
}
