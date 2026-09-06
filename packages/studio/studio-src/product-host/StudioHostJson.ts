/** Tao hands the host its models as JSON text; anything that is not an object reads as absent. */
export function parseStudioJson<ValueT>(value: string): ValueT | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as ValueT : undefined
  } catch {
    return undefined
  }
}
