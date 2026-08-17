import React from 'react'

export type TaoAsyncAction<Result = unknown> = {
  error: unknown
  invoke(): Promise<Result | undefined>
  pending: boolean
}

export type TaoAsyncErrorAction = {
  invoke(error: unknown): void
}

export type TaoAsyncFinallyAction = {
  invoke(): void
}

export type TaoAsyncSuccessAction<Result> = {
  invoke(result: Result): void
}

export type TaoAsyncActionOptions<Result> = {
  error?: TaoAsyncErrorAction
  finally?: TaoAsyncFinallyAction
  success?: TaoAsyncSuccessAction<Result>
}

/** Async exposes helpers for bridge actions that complete asynchronously. */
export const Async = {
  /** action wraps an async native bridge in a Pressable-compatible action with pending and error state. */
  action<Result>(run: () => Promise<Result>, options: TaoAsyncActionOptions<Result> = {}): TaoAsyncAction<Result> {
    const [pending, setPending] = React.useState(false)
    const [error, setError] = React.useState<unknown>()
    const mounted = React.useRef(true)

    React.useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])

    const invoke = React.useCallback(async () => {
      setPending(true)
      setError(undefined)
      try {
        const result = await run()
        if (mounted.current) {
          options.success?.invoke(result)
        }
        return result
      } catch (caught) {
        if (mounted.current) {
          setError(caught)
          options.error?.invoke(caught)
        }
        return undefined
      } finally {
        if (mounted.current) {
          setPending(false)
          options.finally?.invoke()
        }
      }
    }, [options, run])

    return { error, invoke, pending }
  },

  /** errorAction adapts async failures into an Async-compatible action. */
  errorAction(work: (error: unknown) => void): TaoAsyncErrorAction {
    return {
      invoke(error) {
        work(error)
      },
    }
  },

  /** finallyAction adapts async completion into an Async-compatible action. */
  finallyAction(work: () => void): TaoAsyncFinallyAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** successAction adapts async results into an Async-compatible action. */
  successAction<Result>(work: (result: Result) => void): TaoAsyncSuccessAction<Result> {
    return {
      invoke(result) {
        work(result)
      },
    }
  },
} as const
