/**
 * Shape guards for values that arrived as JSON. `packages/apps/runtime` keeps its own copies because it
 * imports nothing from `@shared`; keep them in step with these.
 */

/** isRecord narrows to a plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** tryParse parses JSON and yields `undefined` instead of throwing on malformed text. */
export function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
