import { Errors } from '@shared/core'
/** The mount signal: a cancelled product-host mount stops between awaits and unwinds as an AbortError. */
export const StudioMountSignal = {
  isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  },

  throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw Errors.abortError('Tao Studio product host mount was cancelled.')
    }
  },
} as const
