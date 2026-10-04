import { Errors } from '@shared'
import type { ProjectToolingResult } from './ProjectTooling'

export type ProjectRefreshLane = {
  readonly lastResult: ProjectToolingResult | undefined
  requestRefresh(): Promise<ProjectToolingResult>
  dispose(): Promise<void>
}

/** Serializes refreshes and keeps one request made during an active refresh for a later run. */
export function createProjectRefreshLane(
  refresh: () => Promise<ProjectToolingResult>,
  onResult?: (result: ProjectToolingResult) => void,
): ProjectRefreshLane {
  let disposed = false
  let lastResult: ProjectToolingResult | undefined
  let tail: Promise<void> = Promise.resolve()

  return {
    get lastResult() {
      return lastResult
    },
    requestRefresh() {
      if (disposed) {
        return Promise.reject(Errors.abortError('The project tooling watch has been disposed.'))
      }
      const next = tail.then(async () => {
        if (disposed) {
          return Promise.reject(Errors.abortError('The project tooling watch has been disposed.'))
        }
        const result = await refresh()
        lastResult = result
        onResult?.(result)
        return result
      })
      tail = next.then(() => {}, () => {})
      return next
    },
    async dispose() {
      disposed = true
      await tail
    },
  }
}
