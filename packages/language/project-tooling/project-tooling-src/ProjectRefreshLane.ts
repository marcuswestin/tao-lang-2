import { Errors } from '@shared'
import type { ProjectToolingResult } from './ProjectTooling'

type ProjectRefreshOptions = { force?: boolean }

export type ProjectRefreshLane = {
  readonly lastResult: ProjectToolingResult | undefined
  requestRefresh(options?: ProjectRefreshOptions): Promise<ProjectToolingResult>
  dispose(): Promise<void>
}

type RefreshRequest = {
  options: { force: boolean }
  promise: Promise<ProjectToolingResult>
  resolve: (result: ProjectToolingResult) => void
  reject: (reason: unknown) => void
}

/** Serializes refreshes, sharing one later run across requests made during an active refresh. */
export function createProjectRefreshLane(
  refresh: (options: ProjectRefreshOptions) => Promise<ProjectToolingResult>,
  onResult?: (result: ProjectToolingResult) => void,
): ProjectRefreshLane {
  let disposed = false
  let lastResult: ProjectToolingResult | undefined
  let active: Promise<void> | undefined
  let pending: RefreshRequest | undefined

  function run(request: RefreshRequest): void {
    active = Promise.resolve().then(async () => {
      try {
        const result = await refresh(request.options)
        lastResult = result
        onResult?.(result)
        request.resolve(result)
      } catch (error) {
        request.reject(error)
      }
    }).then(() => {
      active = undefined
      const next = pending
      pending = undefined
      if (next) {
        run(next)
      }
    })
  }

  return {
    get lastResult() {
      return lastResult
    },
    requestRefresh(options = {}) {
      if (disposed) {
        return Promise.reject(Errors.abortError('The project tooling watch has been disposed.'))
      }
      if (pending) {
        pending.options.force ||= options.force === true
        return pending.promise
      }
      let resolve!: RefreshRequest['resolve']
      let reject!: RefreshRequest['reject']
      const promise = new Promise<ProjectToolingResult>((promiseResolve, promiseReject) => {
        resolve = promiseResolve
        reject = promiseReject
      })
      const request = { promise, resolve, reject, options: { force: options.force === true } }
      if (active) {
        pending = request
      } else {
        run(request)
      }
      return promise
    },
    async dispose() {
      disposed = true
      pending?.reject(Errors.abortError('The project tooling watch has been disposed.'))
      pending = undefined
      await active
    },
  }
}
