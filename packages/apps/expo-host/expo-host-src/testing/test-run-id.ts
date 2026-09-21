/** TestRunId creates unique filesystem-friendly ids for runtime test artifacts. */
export const TestRunId = {
  create,
} as const

function create(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
